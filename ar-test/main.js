// main.js - Final Classic Script Version
(function() {
    // --- ON-SCREEN CONSOLE OVERRIDE ---
    const originalLog = console.log;
    function appendToConsole(message, type = 'log') {
        const consoleDiv = document.getElementById('onScreenConsole');
        if (!consoleDiv) return;
        const p = document.createElement('p');
        p.textContent = `[${type.toUpperCase()}] ${message}`;
        p.style.margin = '0';
        p.style.lineHeight = '1.2em';
        if (type === 'warn') p.style.color = 'yellow';
        if (type === 'error') p.style.color = 'red';
        consoleDiv.appendChild(p);
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
    console.log = function(...args) {
        originalLog.apply(console, args);
        appendToConsole(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' '), 'log');
    };
})();

// NO IMPORTS - These libraries are now global

// Use the global 'vision' object from MediaPipe's script
const { FaceLandmarker, FilesetResolver } = vision;
// Use the global 'THREE' object from Three.js's script
// Use the global 'WebARRocksObjectThreeHelper' and other helpers

// These are now global, loaded from face_mesh_data.js
const NUM_LANDMARKS = UV_COORDS.length;

// Global variables for the app
let scene, camera, renderer, video, faceLandmarker;
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let debugCube, exportedMeshData = null, ARRocksInitialised = false;
const runningMode = "VIDEO";
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

const _settings = {
    NNPath: './neuralNets/NN_KEYBOARD_5.json'
};

async function init() {
    console.log("init() started.");

    // Setup Scene
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2;
    const canvas = document.getElementById('outputCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(0, 1, 1);
    scene.add(dirLight);
    debugCube = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({color: 0x00ff00, wireframe: true}));
    scene.add(debugCube);

    // Setup MediaPipe
    video = document.getElementById('webcamVideo');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });
    video.width = VIDEO_WIDTH;
    video.height = VIDEO_HEIGHT;

    const visionResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(visionResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
        runningMode: runningMode,
        numFaces: 1
    });

    // Setup Face Mesh
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NUM_LANDMARKS * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(NUM_LANDMARKS * 2), 2));
    geometry.setIndex(FACEMESH_TESSELATION.flat());
    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 512;
    textureCanvas.height = 512;
    textureCanvasCtx = textureCanvas.getContext('2d');
    faceTexture = new THREE.CanvasTexture(textureCanvas);
    const material = new THREE.MeshStandardMaterial({ map: faceTexture, side: THREE.DoubleSide });
    faceMesh = new THREE.Mesh(geometry, material);
    scene.add(faceMesh);

    // Setup UI
    document.getElementById('saveButton').style.display = 'block';
    document.getElementById('saveButton').addEventListener('click', saveMesh);
    const arButton = document.createElement('button');
    arButton.textContent = 'START AR';
    Object.assign(arButton.style, {
        position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: '100',
        padding: '12px 24px', border: '1px solid white', borderRadius: '4px', background: 'rgba(0,0,0,0.5)',
        color: 'white', cursor: 'pointer', fontSize: '16px'
    });
    arButton.onclick = () => { arButton.style.display = 'none'; mainWebARRocks(); };
    document.getElementById('arButtonPlaceholder').appendChild(arButton);
    document.getElementById('loading').style.display = 'none';

    animate();
}

function saveMesh() {
    if (!faceMesh.visible) { console.warn("No visible face to save."); return; }
    const exporter = new THREE.GLTFExporter();
    exporter.parse(faceMesh, (gltf) => {
        exportedMeshData = gltf;
        alert("Face mesh saved to memory!");
    }, (error) => console.error("GLTF Export Error:", error), { binary: true });
}

let lastVideoTime = -1;
function animate() {
    requestAnimationFrame(animate);
    if (ARRocksInitialised) {
        WebARRocksObjectThreeHelper.animate();
    }
    render();
}

function render() {
    faceMesh.visible = !ARRocksInitialised;
    debugCube.visible = !ARRocksInitialised && !faceMesh.visible;
    if (ARRocksInitialised) {
        scene.background = null;
        renderer.setClearAlpha(0);
    } else {
        scene.background = new THREE.Color(0x333333);
        if (video.readyState === video.HAVE_ENOUGH_DATA && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            const results = faceLandmarker.detectForVideo(video, performance.now());
            if (results.faceLandmarks.length > 0) {
                const landmarks = results.faceLandmarks[0];
                const positions = faceMesh.geometry.attributes.position.array;
                for (let i = 0; i < landmarks.length; i++) {
                    positions[i * 3] = (landmarks[i].x - 0.5) * 2;
                    positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
                    positions[i * 3 + 2] = -landmarks[i].z;
                }
                faceMesh.geometry.attributes.position.needsUpdate = true;
                faceMesh.geometry.computeVertexNormals();

                textureCanvasCtx.clearRect(0, 0, 512, 512);
                textureCanvasCtx.drawImage(video, 0, 0, 512, 512);
                faceTexture.needsUpdate = true;
            }
        }
    }
    renderer.render(scene, camera);
}

let _DOMVideo;
function mainWebARRocks() {
    _DOMVideo = document.getElementById('webcamVideo');
    if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }
    WebARRocksMediaStreamAPIHelper.get(_DOMVideo, initWebARRocks, (err) => console.error(err), { video: { facingMode: { ideal: 'environment' } } });
}

function initWebARRocks() {
    document.getElementById('ARCanvas').style.display = 'block';
    document.getElementById('threeCanvas').style.display = 'block';
    WebARRocksObjectThreeHelper.init({
        video: _DOMVideo,
        ARCanvas: document.getElementById('ARCanvas'),
        threeCanvas: document.getElementById('threeCanvas'),
        NNPath: _settings.NNPath, // Pass the NNPath
        callbackReady: function() {
            ARRocksInitialised = true; // Set flag only when ready
            startWebARRocks();
        }
    });
}

function startWebARRocks() {
    if (exportedMeshData) {
        const loader = new THREE.GLTFLoader();
        loader.parse(exportedMeshData, (gltf) => {
            const loadedMesh = gltf.scene;
            loadedMesh.scale.set(0.2, 0.2, 0.2);
            WebARRocksObjectThreeHelper.add('KEYBOARD', loadedMesh);
        });
    } else {
        const arCube = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshNormalMaterial());
        WebARRocksObjectThreeHelper.add('KEYBOARD', arCube);
    }
}

// Start the application
init();
