import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
// MapControls = OrbitControls 인데 LEFT=PAN, RIGHT=ROTATE 로 디폴트 매핑이 미리
// 잡힌 서브클래스. three.js 공식 example "misc_controls_map.html" 의 표준 패턴.
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'  // type only
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
// WebGL native LineBasicMaterial.linewidth 는 1px 로 강제 — 두꺼운 라인 위해 Line2 사용.
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

// Draco wasm decoder (single instance) — public/draco/ 에서 self-host. 모듈 전체에서
// 공유하면 worker pool 도 한 번만 생성. preload() 로 첫 frame 전에 wasm 로드 끝남.
let _dracoLoader: DRACOLoader | null = null
function getDracoLoader(): DRACOLoader {
  if (_dracoLoader) return _dracoLoader
  const loader = new DRACOLoader()
  loader.setDecoderPath('/draco/')
  loader.setDecoderConfig({ type: 'wasm' })
  loader.preload()
  _dracoLoader = loader
  return loader
}

// Foxglove-style 진짜 3D scene MapCanvas. 모든 객체 (격자/맵/pose/path/trajectory/
// spot/cloud/mesh) 를 단일 Three.js scene 에 두어 카메라 한 번 회전으로 일관된 view.
//
// 좌표계: ROS map frame (x, y, z), z=up, 미터 단위.
//   - x: 우(앞)
//   - y: 좌(좌측)
//   - z: 위
//
// 카메라: PerspectiveCamera + OrbitControls (foxglove 같은 yaw + pitch + dolly).
//   - 좌클릭 드래그 = orbit (yaw + pitch 동시)
//   - 우클릭 드래그 = pan
//   - 휠 = zoom (dolly)
//
// 마우스 클릭 → world 좌표: raycaster 가 z=0 평면 hit point 계산.

type LiveMeta = {
  width: number; height: number; resolution: number
  origin_x: number; origin_y: number; updated_at: number
}

export interface Map3DCanvasProps {
  // RobotsPage 의 LivePoseExt 와 호환: x/y/yaw_rad 가 null 일 수 있음.
  pose?: {
    x?: number | null
    y?: number | null
    yaw_rad?: number | null
    available?: boolean
  }
  armed?: boolean
  armedKind?: 'goto' | 'teleport' | null
  goalPreview?: { x: number; y: number } | null
  teleportPreview?: { x: number; y: number } | null
  onMapClickWorld?: (x: number, y: number) => void
  onHoverWorld?: (xy: { x: number; y: number } | null) => void
  eventIdle?: boolean
  showMesh?: boolean   // nvblox 3D mesh overlay 토글 (Phase 3)
  // 사용자 관리 스팟 (Location 엔티티) — MapDetailPage 등에서 백엔드 스팟을 맵 위에
  // 그릴 때 사용. PARCEL_PICKUP 은 노란 별, 일반 스팟은 파란 점. /ws/ocr 의
  // OCR 자동 트랙(spotsGroupRef) 과 별개 그룹.
  userSpots?: Array<{ id: number; name: string; type: string; x: number; y: number }>
}

export function Map3DCanvas(props: Map3DCanvasProps) {
  const {
    pose, armed, armedKind, goalPreview, teleportPreview,
    onMapClickWorld, onHoverWorld, eventIdle,
    showMesh: showMeshProp,
    userSpots,
  } = props
  void eventIdle  // path/trajectory 는 server-driven 이라 idle 상태 별 로직 불필요
  // showMesh: prop 가 주어지면 그대로 (controlled), 없으면 자체 state.
  const [showMeshState, setShowMeshState] = useState(true)
  const showMesh = showMeshProp ?? showMeshState

  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const mapMeshRef = useRef<THREE.Mesh | null>(null)
  const poseGroupRef = useRef<THREE.Group | null>(null)
  // pose 의 최신 값을 ref 로 — WebSocket 콜백 안에서 stale closure 안 잡히게.
  const poseRef = useRef<typeof pose>(pose)
  useEffect(() => {
    poseRef.current = pose
    // pose 가 늦게 도착했고 첫 카메라 init 이 맵 중심으로 fallback 됐으면, 한 번
    // 자동 recenter (사용자가 그 사이에 view 조작 안 했다는 가정 — 실제로 pose
    // 없는 동안 마우스 만질 일은 거의 없음).
    if (camFallbackUsedRef.current && pose && pose.available && pose.x != null && pose.y != null) {
      const ctrl = controlsRef.current
      const cam = cameraRef.current
      if (ctrl && cam) {
        const dx = cam.position.x - ctrl.target.x
        const dy = cam.position.y - ctrl.target.y
        const dz = cam.position.z - ctrl.target.z
        ctrl.target.set(pose.x, pose.y, 0)
        // 카메라 position 도 같은 offset 만큼 평행이동 — 시각적 변화는 (이전
        // 맵 중심 → 로봇 위치) panning 만, 회전/줌은 그대로.
        cam.position.set(pose.x + dx, pose.y + dy, dz)
        ctrl.update()
        camFallbackUsedRef.current = false
      }
    }
  }, [pose])
  const goalMarkerRef = useRef<THREE.Group | null>(null)
  const teleportMarkerRef = useRef<THREE.Group | null>(null)
  const pathLineRef = useRef<Line2 | null>(null)
  const trajLineRef = useRef<Line2 | null>(null)
  const pathMatRef = useRef<LineMaterial | null>(null)
  const trajMatRef = useRef<LineMaterial | null>(null)
  const frontiersGroupRef = useRef<THREE.Group | null>(null)
  const spotsGroupRef = useRef<THREE.Group | null>(null)
  // 사용자 관리 스팟 (Location 엔티티) — userSpots prop 으로 주입.
  const userSpotsGroupRef = useRef<THREE.Group | null>(null)
  const cloudPointsRef = useRef<THREE.Points | null>(null)
  const meshGroupRef = useRef<THREE.Group | null>(null)
  // RTAB-Map /rtabmap/cloud_map → voxel scene (nvblox mesh 대용). RGB 점.
  // voxelMap: (ix,iy,iz) → (r,g,b)  — string key 로 캐시 (Map<key, [r,g,b]>).
  const voxelPointsRef = useRef<THREE.Points | null>(null)
  const voxelMapRef = useRef<Map<string, [number, number, number]>>(new Map())
  const voxelSizeRef = useRef(0.10)
  const voxelDirtyRef = useRef(false)  // delta 적용 후 BufferAttribute 재구성 trigger
  const meshMapRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const ground0Ref = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  const mapHadLoadedRef = useRef(false)
  // 첫 카메라 init 이 pose 없이 맵 중심으로 fallback 됐는지 — pose 가 늦게 도착하면
  // 그때 한 번 더 로봇 위치로 자동 recenter.
  const camFallbackUsedRef = useRef(false)
  const dragMovedRef = useRef(false)
  const dragDownRef = useRef<{ x: number; y: number } | null>(null)

  const [meta, setMeta] = useState<LiveMeta | null>(null)
  const [mapLive, setMapLive] = useState(false)

  // ── Three setup ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setClearColor(0xf1f5f9, 1)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()

    // 조명 — directional 가 mesh 의 face normal 기반 음영 제공.
    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const dl = new THREE.DirectionalLight(0xffffff, 0.6)
    dl.position.set(3, 4, 8)
    scene.add(dl)

    // 격자 — 50m × 50m, 1m grid. GridHelper 의 default xz plane → x,y 평면으로 회전.
    const grid = new THREE.GridHelper(50, 50, 0xa3b0c4, 0xdbe2eb)
    grid.rotation.x = Math.PI / 2
    grid.position.z = -0.001  // map mesh 와 z-fight 회피
    scene.add(grid)

    // (axes helper 제거 — 사용자 요청)

    // pose 그룹 — cone 으로 robot 표시.
    // 위치 기준: cone 의 base(뒤쪽) 가 로봇 위치 = 화살표 꼬리 = 그룹 origin.
    // tip(앞쪽) 은 +X 방향으로 뻗어 정면 표시. 작은 점을 origin 에 두어
    // 정확한 base_link 위치 시각적 확인 가능.
    const poseGroup = new THREE.Group()
    const CONE_LEN = 0.45
    const poseGeom = new THREE.ConeGeometry(0.15, CONE_LEN, 12)
    // ConeGeometry default: base at -y, tip at +y, origin at center.
    // 1) rotateZ → base at +x_neg, tip at +x_pos, origin still at center
    // 2) translate(+CONE_LEN/2, 0, 0) → base at origin, tip at (+CONE_LEN, 0, 0)
    poseGeom.rotateZ(-Math.PI / 2)
    poseGeom.translate(CONE_LEN / 2, 0, 0)
    const poseMat = new THREE.MeshLambertMaterial({ color: 0x2563eb })
    const poseMesh = new THREE.Mesh(poseGeom, poseMat)
    poseMesh.position.z = 0.05
    poseGroup.add(poseMesh)
    // 정확한 robot 위치 마커 — cone base 끝의 작은 sphere (강조용)
    const poseDotG = new THREE.SphereGeometry(0.06, 12, 12)
    const poseDotM = new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    const poseDot = new THREE.Mesh(poseDotG, poseDotM)
    poseDot.position.set(0, 0, 0.05)
    poseGroup.add(poseDot)
    poseGroup.visible = false
    scene.add(poseGroup)
    poseGroupRef.current = poseGroup

    // goal marker (target reticle) — torus + cross.
    const goalGroup = new THREE.Group()
    const torusG = new THREE.TorusGeometry(0.25, 0.04, 8, 24)
    const goalMat = new THREE.MeshBasicMaterial({ color: 0x1d4ed8 })
    goalGroup.add(new THREE.Mesh(torusG, goalMat))
    const goalDotG = new THREE.SphereGeometry(0.05, 8, 8)
    goalGroup.add(new THREE.Mesh(goalDotG, goalMat))
    goalGroup.visible = false
    scene.add(goalGroup)
    goalMarkerRef.current = goalGroup

    // teleport marker — orange torus.
    const tpGroup = new THREE.Group()
    const tpMat = new THREE.MeshBasicMaterial({ color: 0xea580c })
    tpGroup.add(new THREE.Mesh(torusG.clone(), tpMat))
    tpGroup.add(new THREE.Mesh(goalDotG.clone(), tpMat))
    tpGroup.visible = false
    scene.add(tpGroup)
    teleportMarkerRef.current = tpGroup


    // Nav2 /plan path — Line2 (blue, 6px).
    {
      const mat = new LineMaterial({
        color: 0x2563eb, linewidth: 6, worldUnits: false,
        resolution: new THREE.Vector2(1, 1),
      })
      const geo = new LineGeometry()
      geo.setPositions([0, 0, 0])
      const line = new Line2(geo, mat)
      line.position.z = 0.02
      line.computeLineDistances()
      scene.add(line)
      pathLineRef.current = line
      pathMatRef.current = mat
    }

    // 지나간 trajectory — Line2 (slate, 3px).
    {
      const mat = new LineMaterial({
        color: 0x64748b, linewidth: 3, worldUnits: false,
        resolution: new THREE.Vector2(1, 1),
      })
      const geo = new LineGeometry()
      geo.setPositions([0, 0, 0])
      const line = new Line2(geo, mat)
      line.position.z = 0.015
      line.computeLineDistances()
      scene.add(line)
      trajLineRef.current = line
      trajMatRef.current = mat
    }

    // explore frontiers — group of green spheres.
    const frontiersGroup = new THREE.Group()
    scene.add(frontiersGroup)
    frontiersGroupRef.current = frontiersGroup

    // ocr spots (room id) — group of spheres + (future text label).
    const spotsGroup = new THREE.Group()
    scene.add(spotsGroup)
    spotsGroupRef.current = spotsGroup

    // user-managed spots (Location 엔티티) — userSpots prop 기반.
    const userSpotsGroup = new THREE.Group()
    scene.add(userSpotsGroup)
    userSpotsGroupRef.current = userSpotsGroup

    // nvblox combined_esdf_pointcloud — Points (z-color gradient).
    {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
      const mat = new THREE.PointsMaterial({
        size: 0.04, vertexColors: true, transparent: true, opacity: 0.6,
      })
      const pts = new THREE.Points(geo, mat)
      scene.add(pts)
      cloudPointsRef.current = pts
    }

    // nvblox mesh group (Phase 3).
    const meshGroup = new THREE.Group()
    scene.add(meshGroup)
    meshGroupRef.current = meshGroup

    // RTAB-Map cloud_map voxel Points (RGB). nvblox mesh 부재 시 시각화 대체.
    // size 는 voxel_size 와 sync 시킬 수 있으나 (sizeAttenuation 켜놓음) 초기 0.10m
    // 기준 가시성 적당히 잡힘. delta 적용 시 BufferAttribute 통째 재구성 (2Hz 이하라 OK).
    {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
      const mat = new THREE.PointsMaterial({
        size: 0.10, vertexColors: true, sizeAttenuation: true,
      })
      const pts = new THREE.Points(geo, mat)
      pts.visible = false  // 초기 OFF — 토글 ON 시 visible=true + WS connect
      scene.add(pts)
      voxelPointsRef.current = pts
    }

    // camera — Z-up, top-down 디폴트 (Google Maps 3D 모델과 동일).
    // ── Camera + MapControls (three.js 공식 misc_controls_map 패턴) ──────
    // Z-up 좌표계용으로 camera.up 만 (0,0,1). 그 외엔 official example 그대로.
    // y -1cm 오프셋: 카메라가 정확히 +Z 위에 있으면 lookAt(target) 의 right
    // 벡터가 (up × view) = 0 (colinear) → three.js 가 fallback axis 를 임의로
    // 골라서 화면 axis 가 90° 틀어짐. 1cm 오프셋 = 0.05° 미만 → 시각적으론 탑뷰.
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
    camera.position.set(0, -0.01, 12)
    camera.up.set(0, 0, 1)
    camera.lookAt(0, 0, 0)

    // MapControls 디폴트: LEFT=PAN, RIGHT=ROTATE, MIDDLE=DOLLY.
    // mouseButtons / touches 다 official 디폴트 활용 — 별도 매핑 X.
    const controls = new MapControls(camera, renderer.domElement)
    controls.target.set(0, 0, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.minDistance = 1
    controls.maxDistance = 100
    // pitch 0 (탑뷰) ~ 90° 직전. yaw 자유.
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI / 2 - 0.001
    // 휠 줌 = 마우스 포인터 기준 (zoom-to-cursor).
    controls.zoomToCursor = true
    // PAN 은 XY 평면 위에서만. 단, MapControls 디폴트 pan 은 카메라-target 거리
    // 기반으로 속도 계산해서 카메라 기울일 때 화면 가장자리 (target 에서 멀리)
    // 잡고 끌면 mouse vs world 비율이 안 맞음 ("그리드 밖 잡으면 이상함").
    // → MapControls pan 비활성 + 자체 drag-anchor pan 으로 대체.
    // (Google Maps / Cesium 방식: mousedown 시점의 world point 가 마우스 아래
    // 항상 박혀있게.)
    controls.enablePan = false

    // ── drag-anchor PAN: 마우스 아래 world point 고정 ────────────────────
    // 절대식 (initial camera 기준): mouseDown 시점의 camera/target 을 보존하고,
    // 매 mousemove 마다 _그 initial 위치에서_ 새 NDC 로 ray 쏴 ground hit 을
    // 구한 뒤 camera = initial + (anchor - hit) 로 _절대_ 적용. 누적식 (camera
    // += delta) 은 매 frame 카메라가 이미 이동한 상태에서 ray 가 다시 다른 hit
    // 을 만들어 mouse 정지해도 진동이 누적됨 — 그 패턴을 절대식으로 바꿔 진동 X.
    const panAnchor = new THREE.Vector3()
    const panNdc = new THREE.Vector2()
    const panRay = new THREE.Raycaster()
    const panHit = new THREE.Vector3()
    const panInitialCam = new THREE.Vector3()
    const panInitialTarget = new THREE.Vector3()
    let panActive = false
    // 카메라에서 너무 먼 hit 은 horizon 근처라 mouse 작은 이동 ↔ world 거대 이동
    // → 카메라 점프. 카메라 높이의 N배 안의 hit 만 drag-anchor 로 받고, 더 멀면
    // pan 자체를 시작 안 한다 (사용자가 그리드 안쪽으로 다시 잡도록).
    const PAN_MAX_DIST_FACTOR = 5
    const isHitNear = (hit: THREE.Vector3) => {
      const camHeight = Math.max(0.1, Math.abs(camera.position.z))
      const dx = hit.x - camera.position.x
      const dy = hit.y - camera.position.y
      return Math.sqrt(dx * dx + dy * dy) < camHeight * PAN_MAX_DIST_FACTOR
    }
    const onPanDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const rect = renderer.domElement.getBoundingClientRect()
      panNdc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      panRay.setFromCamera(panNdc, camera)
      if (!panRay.ray.intersectPlane(ground0Ref.current, panAnchor)) return
      if (!isHitNear(panAnchor)) return  // horizon 영역 click → pan 안 시작
      // mouseDown 시점의 카메라/타깃 _스냅샷_. 이후 모든 pan 계산은 이 스냅샷
      // 기준 — frame 의 임시 lerp 상태와 무관해서 진동 없음.
      panInitialCam.copy(camera.position)
      panInitialTarget.copy(controls.target)
      panActive = true
      controls.enableDamping = false
    }
    const onPanMove = (e: PointerEvent) => {
      if (!panActive) return
      const rect = renderer.domElement.getBoundingClientRect()
      panNdc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      // 카메라를 _initial_ 위치로 가상 복귀시킨 뒤 ray 쏘기. updateMatrixWorld
      // 로 변환 행렬을 그 위치 기준으로 다시 빌드. 그 후 setFromCamera 가
      // 정확히 mouseDown 시점의 카메라 viewport 에서 본 ray 를 구함.
      camera.position.copy(panInitialCam)
      camera.updateMatrixWorld(true)
      panRay.setFromCamera(panNdc, camera)
      if (!panRay.ray.intersectPlane(ground0Ref.current, panHit)) {
        // ray miss — 위치 복원만 하고 적용은 skip
        return
      }
      if (!isHitNear(panHit)) return
      // 절대 적용: camera = initial + (anchor - hit). 누적 X → 진동 X.
      const dx = panAnchor.x - panHit.x
      const dy = panAnchor.y - panHit.y
      camera.position.set(
        panInitialCam.x + dx,
        panInitialCam.y + dy,
        panInitialCam.z,
      )
      controls.target.set(
        panInitialTarget.x + dx,
        panInitialTarget.y + dy,
        panInitialTarget.z,
      )
    }
    const onPanUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (!panActive) return
      panActive = false
      controls.enableDamping = true
    }
    renderer.domElement.addEventListener('pointerdown', onPanDown)
    window.addEventListener('pointermove', onPanMove)
    window.addEventListener('pointerup', onPanUp)

    // 우클릭 컨텍스트 메뉴 차단 (회전 드래그 방해).
    const blockCtx = (e: Event) => e.preventDefault()
    renderer.domElement.addEventListener('contextmenu', blockCtx)

    // resize
    const resize = () => {
      const rect = el.getBoundingClientRect()
      // updateStyle=true: 캔버스 CSS 사이즈 = container 사이즈로 맞춤. false 면 캔버스
      // 가 drawing buffer 크기 (DPR 적용된 큰 값) 그대로 인트린식 표시 → container
      // overflow → 화면에서 보이는 중앙이 캔버스 중앙 (controls.target projection)
      // 과 어긋남 → 회전 pivot 이 화면 중심에 안 맞아 보임.
      renderer.setSize(rect.width, rect.height, true)
      camera.aspect = Math.max(0.001, rect.width / Math.max(1, rect.height))
      camera.updateProjectionMatrix()
      // LineMaterial 은 resolution (px) 을 알아야 두께가 정확히 적용됨.
      pathMatRef.current?.resolution.set(rect.width, rect.height)
      trajMatRef.current?.resolution.set(rect.width, rect.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let stop = false
    const animate = () => {
      if (stop) return
      controls.update()
      renderer.render(scene, camera)
      requestAnimationFrame(animate)
    }
    animate()

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    controlsRef.current = controls

    return () => {
      stop = true
      ro.disconnect()
      renderer.domElement.removeEventListener('contextmenu', blockCtx)
      renderer.domElement.removeEventListener('pointerdown', onPanDown)
      window.removeEventListener('pointermove', onPanMove)
      window.removeEventListener('pointerup', onPanUp)
      controls.dispose()
      // mesh group cleanup
      meshMapRef.current.forEach((m) => {
        m.geometry.dispose()
        const mat = m.material as THREE.Material | THREE.Material[]
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat.dispose()
      })
      meshMapRef.current.clear()
      renderer.dispose()
      try { el.removeChild(renderer.domElement) } catch {}
      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
      controlsRef.current = null
    }
  }, [])

  // ── pose 갱신 ───────────────────────────────────────────────────────────
  useEffect(() => {
    const grp = poseGroupRef.current
    if (!grp) return
    if (!pose?.available || pose.x == null || pose.y == null) {
      grp.visible = false
      return
    }
    grp.visible = true
    grp.position.set(pose.x, pose.y, 0)
    grp.rotation.z = pose.yaw_rad ?? 0
  }, [pose])

  // ── showMesh 토글: meshGroup (nvblox) + voxel Points (rtabmap fallback) ─
  // 같은 토글로 둘 다 ON/OFF. nvblox 가 안 떠있을 때 voxel WS 만 데이터 흐름.
  useEffect(() => {
    const grp = meshGroupRef.current
    if (grp) grp.visible = showMesh
    const vp = voxelPointsRef.current
    if (vp) vp.visible = showMesh
  }, [showMesh])

  // ── goal/teleport preview ──────────────────────────────────────────────
  useEffect(() => {
    const g = goalMarkerRef.current
    if (!g) return
    if (goalPreview) {
      g.visible = true
      g.position.set(goalPreview.x, goalPreview.y, 0.05)
    } else g.visible = false
  }, [goalPreview])
  useEffect(() => {
    const g = teleportMarkerRef.current
    if (!g) return
    if (teleportPreview) {
      g.visible = true
      g.position.set(teleportPreview.x, teleportPreview.y, 0.05)
    } else g.visible = false
  }, [teleportPreview])

  // ── userSpots (Location 엔티티) → 그룹 재생성 ───────────────────────────
  // 변경 시 전체 children dispose + 재생성. 스팟 수 보통 < 100 이라 비싸지 않음.
  useEffect(() => {
    const grp = userSpotsGroupRef.current
    if (!grp) return
    while (grp.children.length) {
      const c = grp.children[0] as THREE.Mesh | THREE.Sprite
      grp.remove(c)
      if ((c as any).geometry) (c as any).geometry.dispose?.()
      const m = (c as any).material as THREE.Material | undefined
      if (m) {
        if ((m as any).map) (m as any).map.dispose?.()
        m.dispose?.()
      }
    }
    if (!userSpots || userSpots.length === 0) return

    const makeSpotLabel = (text: string, pickup: boolean): THREE.Sprite => {
      const canvas = document.createElement('canvas')
      const W = 256, H = 80
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = pickup ? 'rgba(245,158,11,0.95)' : 'rgba(59,130,246,0.95)'
      ctx.fillRect(0, 0, W, H)
      ctx.lineWidth = 4
      ctx.strokeStyle = 'white'
      ctx.strokeRect(2, 2, W - 4, H - 4)
      ctx.fillStyle = 'white'
      ctx.font = 'bold 44px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText((pickup ? '★ ' : '') + text, W / 2, H / 2)
      const tex = new THREE.CanvasTexture(canvas)
      tex.needsUpdate = true
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
      const sp = new THREE.Sprite(mat)
      sp.scale.set(1.5, 0.5, 1)
      return sp
    }

    for (const s of userSpots) {
      const pickup = s.type === 'PARCEL_PICKUP'
      const geo = new THREE.SphereGeometry(pickup ? 0.25 : 0.18, 14, 14)
      const mat = new THREE.MeshLambertMaterial({ color: pickup ? 0xf59e0b : 0x3b82f6 })
      const m = new THREE.Mesh(geo, mat)
      m.position.set(s.x, s.y, 0.35)
      grp.add(m)
      const label = makeSpotLabel(s.name, pickup)
      label.position.set(s.x, s.y, 0.85)
      grp.add(label)
    }
  }, [userSpots])

  // ── /ws/map 구독: occupancy grid 를 PlaneGeometry texture 로 ───────────
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/map`
    let ws: WebSocket | null = null
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let pendingMeta: LiveMeta | null = null
    const loader = new THREE.TextureLoader()
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onclose = () => {
        if (!stopped && !document.hidden) timer = setTimeout(connect, 2000)
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try { pendingMeta = JSON.parse(ev.data) as LiveMeta } catch {}
        } else if (ev.data instanceof ArrayBuffer) {
          const blob = new Blob([ev.data], { type: 'image/png' })
          const oURL = URL.createObjectURL(blob)
          loader.load(oURL, (tex) => {
            URL.revokeObjectURL(oURL)
            tex.magFilter = THREE.NearestFilter
            tex.minFilter = THREE.NearestFilter
            tex.colorSpace = THREE.SRGBColorSpace
            tex.flipY = true  // ROS occupancy PNG row 0 = top, three default texY up.
            const m = pendingMeta
            if (!m) { tex.dispose(); return }
            setMeta(m)
            setMapLive(true)
            const w_m = m.width * m.resolution
            const h_m = m.height * m.resolution
            const cx = m.origin_x + w_m / 2
            const cy = m.origin_y + h_m / 2
            const scene = sceneRef.current
            if (!scene) { tex.dispose(); return }
            const old = mapMeshRef.current
            if (old) {
              scene.remove(old)
              old.geometry.dispose()
              ;(old.material as THREE.MeshBasicMaterial).map?.dispose()
              ;(old.material as THREE.Material).dispose()
            }
            const geo = new THREE.PlaneGeometry(w_m, h_m)
            const mat = new THREE.MeshBasicMaterial({
              map: tex, transparent: true, depthWrite: false,
            })
            const mesh = new THREE.Mesh(geo, mat)
            mesh.position.set(cx, cy, 0)
            scene.add(mesh)
            mapMeshRef.current = mesh
            // 첫 map 로드 시 한 번만 카메라 정렬. 사용자가 이후 pan/zoom/rotate
            // 한 위치는 절대 안 건드림.
            // 디폴트 위치 = 로봇 pose. pose 가 아직 안 왔으면 맵 중심으로 fallback.
            const ctrl = controlsRef.current
            const cam = cameraRef.current
            if (ctrl && cam && !mapHadLoadedRef.current) {
              const p = poseRef.current
              const havePose = !!(p && p.available && p.x != null && p.y != null)
              const px = havePose ? p!.x! : cx
              const py = havePose ? p!.y! : cy
              const yaw = havePose ? (p!.yaw_rad ?? 0) : 0
              const span = Math.max(w_m, h_m)
              const eps = 0.01
              ctrl.target.set(px, py, 0)
              // 카메라 offset 을 robot forward 반대 방향으로 → 화면 위쪽 = 로봇 정면.
              cam.position.set(px - Math.cos(yaw) * eps, py - Math.sin(yaw) * eps, span * 1.2)
              cam.up.set(0, 0, 1)
              cam.lookAt(px, py, 0)
              ctrl.update()
              mapHadLoadedRef.current = true
              camFallbackUsedRef.current = !havePose  // pose 없이 init 했으면 표식
            }
          })
        }
      }
    }
    const onVis = () => {
      if (document.hidden) {
        if (ws) { try { ws.close() } catch {} ; ws = null }
      } else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
    }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      if (timer) clearTimeout(timer)
      if (ws) try { ws.close() } catch {}
    }
  }, [])

  // Line2 의 LineGeometry 는 setPositions(flat number[]) API 사용. 점 1개 이하면 숨김.
  const updateLine2 = (line: Line2 | null, pts: Array<[number, number]>, z: number) => {
    if (!line) return
    if (pts.length < 2) { line.visible = false; return }
    const flat: number[] = []
    for (const [x, y] of pts) { flat.push(x, y, z) }
    ;(line.geometry as LineGeometry).setPositions(flat)
    line.computeLineDistances()
    line.visible = true
  }

  // ── /ws/path: Nav2 plan polyline ───────────────────────────────────────
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/path`
    const cleanup = connectJsonWs(url, (msg) => {
      const pts = (msg?.points as Array<[number, number]> | undefined) ?? []
      updateLine2(pathLineRef.current, pts, 0)
    })
    return cleanup
  }, [])

  // ── /ws/trajectory: 지나간 경로 polyline ───────────────────────────────
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/trajectory`
    const cleanup = connectJsonWs(url, (msg) => {
      const pts = (msg?.points as Array<[number, number]> | undefined) ?? []
      updateLine2(trajLineRef.current, pts, 0)
    })
    return cleanup
  }, [])

  // ── /ws/frontiers: explore_lite 후보 (green sphere) ─────────────────────
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/frontiers`
    const cleanup = connectJsonWs(url, (msg) => {
      const pts = (msg?.points as Array<[number, number]> | undefined) ?? []
      const grp = frontiersGroupRef.current
      if (!grp) return
      // 기존 자식 모두 dispose
      while (grp.children.length) {
        const c = grp.children[0] as THREE.Mesh
        grp.remove(c)
        c.geometry.dispose()
        ;(c.material as THREE.Material).dispose()
      }
      const geo = new THREE.SphereGeometry(0.12, 8, 8)
      const mat = new THREE.MeshLambertMaterial({ color: 0x10b981 })
      for (const [x, y] of pts) {
        const m = new THREE.Mesh(geo.clone(), mat.clone())
        m.position.set(x, y, 0.1)
        grp.add(m)
      }
    })
    return cleanup
  }, [])

  // ── /ws/ocr: room id spot 마커 (보라색 sphere + room_id 텍스트 라벨) ───
  useEffect(() => {
    // room_id 를 sprite 텍스처로 만드는 헬퍼.
    const makeLabel = (text: string, confirmed: boolean): THREE.Sprite => {
      const canvas = document.createElement('canvas')
      const W = 256, H = 96
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')!
      // 반투명 흰 박스 + 보라 테두리
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.fillRect(0, 0, W, H)
      ctx.lineWidth = 6
      ctx.strokeStyle = confirmed ? '#7e22ce' : '#a78bfa'
      ctx.strokeRect(3, 3, W - 6, H - 6)
      ctx.fillStyle = confirmed ? '#581c87' : '#6b21a8'
      ctx.font = 'bold 56px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, W / 2, H / 2)
      const tex = new THREE.CanvasTexture(canvas)
      tex.needsUpdate = true
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
      const sp = new THREE.Sprite(mat)
      sp.scale.set(1.6, 0.6, 1)  // 월드 단위 (1.6m × 0.6m)
      return sp
    }

    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/ocr`
    const cleanup = connectJsonWs(url, (msg) => {
      const tracks = (msg?.tracks as Array<{ x: number; y: number; room_id?: string; confirmed?: boolean }> | undefined) ?? []
      const grp = spotsGroupRef.current
      if (!grp) return
      // 기존 children 정리 (sphere + sprite 둘 다 dispose)
      while (grp.children.length) {
        const c = grp.children[0] as THREE.Mesh | THREE.Sprite
        grp.remove(c)
        const anyMat = (c as any).material as THREE.Material | undefined
        if ((c as any).geometry) (c as any).geometry.dispose?.()
        if (anyMat) {
          if ((anyMat as any).map) (anyMat as any).map.dispose?.()
          anyMat.dispose?.()
        }
      }
      // 작은 sphere (0.15m) + 라벨. 점은 표지판 위치 표시이지 visible volume 아님.
      const geo = new THREE.SphereGeometry(0.15, 12, 12)
      for (const t of tracks) {
        const color = t.confirmed ? 0xa855f7 : 0xc4b5fd
        const m = new THREE.Mesh(geo.clone(), new THREE.MeshLambertMaterial({ color }))
        m.position.set(t.x, t.y, 0.3)
        grp.add(m)
        // 텍스트 라벨 (sphere 약간 위)
        if (t.room_id) {
          const label = makeLabel(String(t.room_id), !!t.confirmed)
          label.position.set(t.x, t.y, 0.7)
          // 라벨 크기도 줄임 (1.6 × 0.6 → 0.8 × 0.3 m)
          label.scale.set(0.8, 0.3, 1)
          grp.add(label)
        }
      }
    })
    return cleanup
  }, [])

  // ── /ws/cloud: nvblox PointCloud2 → THREE.Points (z-color) ─────────────
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/cloud`
    let ws: WebSocket | null = null
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onclose = () => {
        if (!stopped && !document.hidden) timer = setTimeout(connect, 2000)
      }
      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return
        const verts = new Float32Array(ev.data)
        const n = (verts.length / 3) | 0
        const pts = cloudPointsRef.current
        if (!pts || n === 0) return
        // z 범위 → viridis-ish color.
        let zmin = Infinity, zmax = -Infinity
        for (let i = 0; i < n; i++) {
          const z = verts[i * 3 + 2]
          if (z < zmin) zmin = z
          if (z > zmax) zmax = z
        }
        const zspan = Math.max(0.1, zmax - zmin)
        const colors = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) {
          const t = (verts[i * 3 + 2] - zmin) / zspan
          colors[i * 3]     = (70  + 185 * t) / 255
          colors[i * 3 + 1] = (40  + 200 * t) / 255
          colors[i * 3 + 2] = (180 - 140 * t) / 255
        }
        pts.geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3))
        pts.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        pts.geometry.computeBoundingSphere()
      }
    }
    const onVis = () => {
      if (document.hidden) {
        if (ws) { try { ws.close() } catch {} ; ws = null }
      } else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
    }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      if (timer) clearTimeout(timer)
      if (ws) try { ws.close() } catch {}
    }
  }, [])

  // ── /ws/scene: nvblox 3D mesh (Phase 3) ─────────────────────────────────
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/scene`
    let ws: WebSocket | null = null
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const decoder = new TextDecoder()
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onclose = () => {
        if (!stopped && !document.hidden) timer = setTimeout(connect, 2000)
      }
      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return
        // Draco decode 는 async (web worker) → frame 처리는 비동기 chain.
        // 빠른 frame 들끼리 race 가능하지만 entity id 별 마지막 적용이 이김
        // (delta 누적 모델이라 안전).
        decodeMeshFrame(ev.data, decoder, meshGroupRef.current, meshMapRef.current)
          .catch((e) => console.warn('mesh frame fail', e))
      }
    }
    const onVis = () => {
      if (document.hidden) {
        if (ws) { try { ws.close() } catch {} ; ws = null }
      } else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
    }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      if (timer) clearTimeout(timer)
      if (ws) try { ws.close() } catch {}
    }
  }, [])

  // ── /ws/voxels: RTAB-Map cloud_map voxel scene (nvblox mesh 대용) ──────
  // showMesh OFF 면 connect 하지 않음 (트래픽 0). 다시 ON 시 새 effect 가 reconnect.
  // 첫 frame 은 캐시 전체 (added), 이후 frame 은 added/removed delta.
  // delta 적용 후 BufferAttribute 통째 재구성 — rate cap 2Hz 이라 GC 부담 미미.
  useEffect(() => {
    if (!showMesh) return  // 토글 OFF 면 WS 자체 안 띄움
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/voxels`
    let ws: WebSocket | null = null
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const connect = () => {
      if (stopped || document.hidden) return
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onclose = () => {
        if (!stopped && !document.hidden) timer = setTimeout(connect, 2000)
      }
      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return
        const applied = applyVoxelFrame(ev.data, voxelMapRef.current, voxelSizeRef)
        if (applied) {
          rebuildVoxelPoints(voxelMapRef.current, voxelSizeRef.current,
                             voxelPointsRef.current)
        }
      }
    }
    const onVis = () => {
      if (document.hidden) {
        if (ws) { try { ws.close() } catch {} ; ws = null }
      } else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
    }
    document.addEventListener('visibilitychange', onVis)
    connect()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      if (timer) clearTimeout(timer)
      if (ws) try { ws.close() } catch {}
    }
  }, [showMesh])

  // ── 마우스 클릭 → world 좌표 (raycaster on z=0 plane) ───────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragMovedRef.current = false
    dragDownRef.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragDownRef.current
    if (d) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMovedRef.current = true
    }
    // hover (armed 상태에서 reticle 표시)
    if (!onHoverWorld) return
    const w = computeWorldPoint(e.clientX, e.clientY)
    onHoverWorld(w)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const wasDrag = dragMovedRef.current
    dragDownRef.current = null
    if (wasDrag) return
    if (e.button !== 0 || !armed) return
    const w = computeWorldPoint(e.clientX, e.clientY)
    if (w) onMapClickWorld?.(w.x, w.y)
  }
  const computeWorldPoint = (clientX: number, clientY: number) => {
    const cam = cameraRef.current
    const renderer = rendererRef.current
    if (!cam || !renderer) return null
    const rect = renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, cam)
    const hit = new THREE.Vector3()
    if (!ray.ray.intersectPlane(ground0Ref.current, hit)) return null
    return { x: hit.x, y: hit.y }
  }

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${
        armed ? 'cursor-crosshair' : 'cursor-default'
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* armed dim overlay */}
      {armed && (
        <div className="pointer-events-none absolute inset-0 ring-4 ring-inset ring-blue-400/60">
          <div className="absolute inset-0 bg-slate-950/15" />
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow">
            {armedKind === 'teleport' ? '맵을 클릭해서 텔레포트' : '맵을 클릭해서 목적지 지정'}
          </div>
        </div>
      )}
      {!meta && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-sm text-slate-400">
          no map · SLAM 시작 시 표시
        </div>
      )}
      {/* 우상단 — 탑뷰 (로봇 중심 + 로봇 정면이 화면 위) + mesh 토글 */}
      <button
        type="button"
        onClick={() => {
          const ctrl = controlsRef.current
          const cam = cameraRef.current
          if (!ctrl || !cam) return
          const p = poseRef.current
          const haveP = !!(p && p.available && p.x != null && p.y != null)
          const tx = haveP ? p!.x! : ctrl.target.x
          const ty = haveP ? p!.y! : ctrl.target.y
          // 카메라-target 거리 유지. 정통 top-down + 화면 위쪽 = 로봇 정면.
          // 카메라 offset 을 robot forward 의 반대 방향으로 두면 lookAt 의 right
          // vector 가 robot 의 오른쪽이 되고, screen up 이 robot forward 가 됨.
          const yaw = haveP ? (p!.yaw_rad ?? 0) : 0
          const odx = cam.position.x - ctrl.target.x
          const ody = cam.position.y - ctrl.target.y
          const odz = cam.position.z - ctrl.target.z
          const dist = Math.max(2, Math.sqrt(odx * odx + ody * ody + odz * odz))
          // 1cm offset, robot forward 의 반대 (-cos(yaw), -sin(yaw)) 방향.
          const eps = 0.01
          ctrl.target.set(tx, ty, 0)
          cam.position.set(tx - Math.cos(yaw) * eps, ty - Math.sin(yaw) * eps, dist)
          cam.up.set(0, 0, 1)
          cam.lookAt(tx, ty, 0)
          ctrl.update()
        }}
        title="탑뷰 (로봇 중심 + 로봇 정면이 화면 위)"
        className="absolute right-2 top-2 rounded border border-slate-300 bg-white/90 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
      >
        탑뷰
      </button>
      {showMeshProp === undefined && (
        <button
          type="button"
          onClick={() => setShowMeshState((v) => !v)}
          title="nvblox 3D mesh on/off"
          className={`absolute right-16 top-2 rounded border px-2 py-1 text-xs font-medium ${
            showMesh
              ? 'border-emerald-400 bg-emerald-500 text-white hover:bg-emerald-600'
              : 'border-slate-300 bg-white/90 text-slate-700 hover:bg-white'
          }`}
        >
          mesh {showMesh ? 'on' : 'off'}
        </button>
      )}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/90 px-2 py-0.5 font-mono text-xs text-slate-500 backdrop-blur">
        {mapLive ? <span className="text-emerald-600">●</span> : <span className="text-slate-300">○</span>}
        {' '}3D · 좌드래그=이동 우드래그=회전 휠=줌
        {armed && armedKind === 'goto' && <span className="ml-2 text-blue-600">· 클릭=goal</span>}
        {armed && armedKind === 'teleport' && <span className="ml-2 text-orange-600">· 클릭=텔레포트</span>}
      </div>
    </div>
  )
}

// JSON ws 구독 헬퍼 — visibility-aware reconnect 패턴 공통화.
function connectJsonWs(url: string, onMsg: (msg: unknown) => void): () => void {
  let ws: WebSocket | null = null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const connect = () => {
    if (stopped || document.hidden) return
    ws = new WebSocket(url)
    ws.onclose = () => {
      if (!stopped && !document.hidden) timer = setTimeout(connect, 2000)
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      try { onMsg(JSON.parse(ev.data)) } catch {}
    }
  }
  const onVis = () => {
    if (document.hidden) {
      if (ws) { try { ws.close() } catch {} ; ws = null }
    } else if (!ws || ws.readyState >= WebSocket.CLOSING) connect()
  }
  document.addEventListener('visibilitychange', onVis)
  connect()
  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVis)
    if (timer) clearTimeout(timer)
    if (ws) try { ws.close() } catch {}
  }
}

// adapter `_serialize_mesh_frame` (binary) 디코딩 → Three.js BufferGeometry 누적/삭제.
// Frame v2 (adapter `_serialize_mesh_frame` 와 1:1):
//   u8  version (= 2)
//   u32 update_count
//   for each: u8 id_len, bytes id, u8 kind (1=Draco, 0=raw fallback),
//             u32 size, bytes payload
//   u32 delete_count
//   for each: u8 id_len, bytes id
//
// kind=1 payload = Draco bitstream → DRACOLoader 가 worker 에서 BufferGeometry 로
// decode. kind=0 payload = 옛 raw layout 의 sub-buffer (DracoPy 미설치 fallback).
async function decodeMeshFrame(
  buf: ArrayBuffer,
  decoder: TextDecoder,
  group: THREE.Group | null,
  meshes: Map<string, THREE.Mesh>,
): Promise<void> {
  if (!group) return
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  let off = 0
  const version = dv.getUint8(off); off += 1
  if (version !== 2) {
    console.warn(`mesh frame: unsupported version ${version}`)
    return
  }
  const upd = dv.getUint32(off, true); off += 4

  // 1단계: header parse (sync, 빠름).
  type Pending = { id: string; kind: number; payload: Uint8Array }
  const pending: Pending[] = []
  for (let i = 0; i < upd; i++) {
    const idLen = dv.getUint8(off); off += 1
    const id = decoder.decode(u8.subarray(off, off + idLen)); off += idLen
    const kind = dv.getUint8(off); off += 1
    const sz = dv.getUint32(off, true); off += 4
    pending.push({ id, kind, payload: u8.subarray(off, off + sz) })
    off += sz
  }
  const del = dv.getUint32(off, true); off += 4
  const deletedIds: string[] = []
  for (let i = 0; i < del; i++) {
    const idLen = dv.getUint8(off); off += 1
    const id = decoder.decode(u8.subarray(off, off + idLen)); off += idLen
    deletedIds.push(id)
  }

  // 2단계: 각 entity 의 BufferGeometry 빌드 (Draco 는 worker, raw 는 sync).
  // 한 frame 안의 entity 들을 병렬 디코딩해 worker pool 활용.
  const loader = getDracoLoader()
  const decoded = await Promise.all(
    pending.map(async ({ id, kind, payload }) => {
      if (kind === 1) {
        // Draco bitstream → BufferGeometry. payload 가 sub-array 라 자체 buffer 로 copy.
        const ab = payload.slice().buffer
        // 주의: decodeDracoFile(buffer, callback, attributeIDs?, attributeTypes?).
        //       4번째 인자는 attributeTypes object — reject 함수를 넘기면 잘못된
        //       config 로 worker 가 silent fail. callback 1개만 넘기고 sync error
        //       만 try/catch.
        const geo: THREE.BufferGeometry = await new Promise((resolve, reject) => {
          try {
            loader.decodeDracoFile(ab, (g: THREE.BufferGeometry) => resolve(g))
          } catch (e) {
            reject(e)
          }
        })
        return { id, geo }
      }
      // Raw fallback (v1 sub-layout).
      const sub = payload
      const subDv = new DataView(sub.buffer, sub.byteOffset, sub.byteLength)
      let so = 0
      const vc = subDv.getUint32(so, true); so += 4
      const verts = new Float32Array(sub.slice(so, so + vc * 12).buffer)
      so += vc * 12
      const hasColor = subDv.getUint8(so); so += 1
      let colors: Float32Array | null = null
      if (hasColor) {
        const cBytes = sub.slice(so, so + vc * 3)
        colors = new Float32Array(vc * 3)
        for (let k = 0; k < vc * 3; k++) colors[k] = cBytes[k] / 255
        so += vc * 3
      }
      const ic = subDv.getUint32(so, true); so += 4
      const indices = new Uint32Array(sub.slice(so, so + ic * 4).buffer)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
      if (colors) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geo.setIndex(new THREE.BufferAttribute(indices, 1))
      return { id, geo }
    }),
  )

  // 3단계: 메쉬 갱신 (sync, group 조작은 main thread).
  for (const { id, geo } of decoded) {
    // Draco 출력은 vertex color 가 'color' 가 아닌 'COLOR_0' 로 들어올 수 있음 — 표준화.
    // (Three.js 의 DRACOLoader 는 COLOR_0 → color attribute 로 매핑, 단 일부 버전은 그대로 둠.)
    if (!geo.getAttribute('color')) {
      const c0 = geo.getAttribute('COLOR_0' as never)
      if (c0) geo.setAttribute('color', c0 as THREE.BufferAttribute)
    }
    const hasColor = geo.getAttribute('color') !== undefined
    let mesh = meshes.get(id)
    if (!mesh) {
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: hasColor, side: THREE.DoubleSide,
      })
      mesh = new THREE.Mesh(geo, mat)
      group.add(mesh)
      meshes.set(id, mesh)
    } else {
      mesh.geometry.dispose()
      mesh.geometry = geo
      ;(mesh.material as THREE.MeshLambertMaterial).vertexColors = hasColor
      ;(mesh.material as THREE.MeshLambertMaterial).needsUpdate = true
    }
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
  }

  // 4단계: 삭제.
  for (const id of deletedIds) {
    const m = meshes.get(id)
    if (m) {
      group.remove(m)
      m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[]
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat.dispose()
      meshes.delete(id)
    }
  }
}

// adapter `_serialize_voxel_frame` (v3) 디코딩 → 클라이언트 voxelMap 갱신.
//   u8  version (=3)
//   u8  flags (bit0=initial_sync)
//   f32 voxel_size_m
//   u32 added_count   [for each: i16 ix, i16 iy, i16 iz, u8 r, u8 g, u8 b]   (9 bytes)
//   u32 removed_count [for each: i16 ix, i16 iy, i16 iz]                     (6 bytes)
//
// initial_sync 면 캐시 비우고 시작 (서버 reset/voxel_size 변경 후).
// 반환: 변경이 있었으면 true (rebuildVoxelPoints 트리거).
function applyVoxelFrame(
  buf: ArrayBuffer,
  voxelMap: Map<string, [number, number, number]>,
  voxelSizeRef: React.MutableRefObject<number>,
): boolean {
  const dv = new DataView(buf)
  let off = 0
  if (dv.getUint8(off) !== 3) return false
  off += 1
  const flags = dv.getUint8(off); off += 1
  const voxelSize = dv.getFloat32(off, true); off += 4
  voxelSizeRef.current = voxelSize
  const isInitial = (flags & 0x01) !== 0
  // initial_sync 의 첫 chunk (i==0 일 때만 adapter 가 flag 켜고, 이어지는 chunk 는
  // flag 0). 클리어는 첫 chunk 도착 시점에 한 번만.
  if (isInitial) voxelMap.clear()
  const addedCount = dv.getUint32(off, true); off += 4
  for (let i = 0; i < addedCount; i++) {
    const ix = dv.getInt16(off, true); off += 2
    const iy = dv.getInt16(off, true); off += 2
    const iz = dv.getInt16(off, true); off += 2
    const r = dv.getUint8(off); off += 1
    const g = dv.getUint8(off); off += 1
    const b = dv.getUint8(off); off += 1
    voxelMap.set(`${ix},${iy},${iz}`, [r, g, b])
  }
  const removedCount = dv.getUint32(off, true); off += 4
  for (let i = 0; i < removedCount; i++) {
    const ix = dv.getInt16(off, true); off += 2
    const iy = dv.getInt16(off, true); off += 2
    const iz = dv.getInt16(off, true); off += 2
    voxelMap.delete(`${ix},${iy},${iz}`)
  }
  return addedCount > 0 || removedCount > 0 || isInitial
}

// voxelMap → THREE.Points BufferGeometry (position + color attribute 전체 재구성).
// 2Hz 이하 갱신이라 매 frame 재구성도 부담 없음. 점 수 ~50K * 12 bytes pos + 12
// bytes color = 1.2 MB/frame, GC 부담 미미. 더 커지면 swap-with-end + size 갱신
// 으로 incremental update 가능 (현 단계 불필요).
function rebuildVoxelPoints(
  voxelMap: Map<string, [number, number, number]>,
  voxelSize: number,
  points: THREE.Points | null,
): void {
  if (!points) return
  const n = voxelMap.size
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  let i = 0
  for (const [key, rgb] of voxelMap) {
    const parts = key.split(',')
    positions[i * 3]     = (parseInt(parts[0], 10)) * voxelSize
    positions[i * 3 + 1] = (parseInt(parts[1], 10)) * voxelSize
    positions[i * 3 + 2] = (parseInt(parts[2], 10)) * voxelSize
    colors[i * 3]     = rgb[0] / 255
    colors[i * 3 + 1] = rgb[1] / 255
    colors[i * 3 + 2] = rgb[2] / 255
    i++
  }
  const geo = points.geometry
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeBoundingSphere()
  // Material size 도 voxel_size 변경에 맞춰 갱신 (서버 voxel_size 변경 후).
  const mat = points.material as THREE.PointsMaterial
  if (mat && mat.size !== voxelSize) {
    mat.size = voxelSize
    mat.needsUpdate = true
  }
}
