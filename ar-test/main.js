// --- NEW: ON-SCREEN CONSOLE OVERRIDE ---
(function() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let consoleDiv = null;

    function appendToConsole(message, type = 'log') {
        if (!consoleDiv) {
            consoleDiv = document.getElementById('onScreenConsole');
            if (!consoleDiv) {
                originalLog("On-screen console div not found. Falling back to default console.");
                return;
            }
        }
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
    console.warn = function(...args) {
        originalWarn.apply(console, args);
        appendToConsole(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' '), 'warn');
    };
    console.error = function(...args) {
        originalError.apply(console, args);
        appendToConsole(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' '), 'error');
    };
})();
// --- END ON-SCREEN CONSOLE OVERRIDE ---

import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

import { FACEMESH_TESSELATION, UV_COORDS } from './face_mesh_data.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- (WebXR variables removed) ---

let scene, camera, renderer;
let video, faceLandmarker, runningMode = "VIDEO";
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let debugCube;
let meshBoxHelper;
let exportedMeshData = null;
let ARRocksInitialised = false; // This will now control our AR state

const NUM_LANDMARKS = UV_COORDS.length;
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

window.init = init;

async function init() {
    console.log("init() started.");

    // 1. Setup Three.js Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;

    const outputCanvasElement = document.getElementById('outputCanvas');
    if (!outputCanvasElement) {
        console.error("ERROR: 'outputCanvas' element not found!");
        return;
    }

    renderer = new THREE.WebGLRenderer({
        canvas: outputCanvasElement,
        antialias: true,
        alpha: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(0, 0, 1).normalize();
    scene.add(directionalLight);

    const debugGeometry = new THREE.BoxGeometry(20, 20, 20);
    const debugMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
    debugCube = new THREE.Mesh(debugGeometry, debugMaterial);
    scene.add(debugCube);

    // 2. Setup Webcam Video (for MediaPipe)
    video = document.getElementById('webcamVideo');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = stream;
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve();
            };
        });
        video.width = VIDEO_WIDTH;
        video.height = VIDEO_HEIGHT;
    } catch (error) {
        console.error("Error accessing webcam:", error);
        document.getElementById('loading').innerText = "Error: Webcam access denied or failed.";
        return;
    }

    // 3. Initialize MediaPipe Face Landmarker
    console.log("Loading MediaPipe model...");
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "CPU"
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: runningMode,
        numFaces: 1,
    });
    console.log("MediaPipe FaceLandmarker loaded.");

    // 4. Create Three.js Face Mesh
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(NUM_LANDMARKS * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const uvs = new Float32Array(NUM_LANDMARKS * 2);
    for (let i = 0; i < NUM_LANDMARKS; i++) {
        uvs[i * 2 + 0] = UV_COORDS[i].x;
        uvs[i * 2 + 1] = 1.0 - UV_COORDS[i].y; // Flip Y for correct mapping
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(FACEMESH_TESSELATION), 1));
    geometry.center();

    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 512;
    textureCanvas.height = 512;
    textureCanvasCtx = textureCanvas.getContext('2d');
    faceTexture = new THREE.CanvasTexture(textureCanvas);
    faceTexture.minFilter = THREE.LinearFilter;
    faceTexture.magFilter = THREE.LinearFilter;
    faceTexture.encoding = THREE.sRGBEncoding;

    const material = new THREE.MeshStandardMaterial({
        map: faceTexture,
        side: THREE.DoubleSide
    });
    faceMesh = new THREE.Mesh(geometry, material);
    faceMesh.visible = false;
    scene.add(faceMesh);

    meshBoxHelper = new THREE.BoxHelper(faceMesh, 0xFF0000);
    meshBoxHelper.visible = false;
    scene.add(meshBoxHelper);

    window.addEventListener('resize', () => {
        if (camera && renderer) {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    });

    const saveButton = document.getElementById('saveButton');
    if (saveButton) {
        saveButton.style.display = 'block';
        saveButton.addEventListener('click', saveMesh);
    }
    
    // --- NEW: Standard Button to Start WebARRocks ---
    const arButtonPlaceholder = document.getElementById('arButtonPlaceholder');
    const startARButton = document.createElement('button');
    startARButton.textContent = 'START AR';
    // Basic styling for the button
    Object.assign(startARButton.style, {
        position: 'absolute',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '100',
        padding: '12px 24px',
        border: '1px solid white',
        borderRadius: '4px',
        background: 'rgba(0,0,0,0.5)',
        color: 'white',
        cursor: 'pointer',
        fontSize: '16px'
    });

    startARButton.onclick = () => {
        console.log("Start AR button clicked.");
        // Hide the button and MediaPipe elements
        startARButton.style.display = 'none';
        faceMesh.visible = false;
        debugCube.visible = false; // Hide the initial debug cube
        meshBoxHelper.visible = false;
        if(video) video.style.display = 'none';
        
        // Start the WebARRocks initialization process
        mainWebARRocks();
    };
    
    // Add the button to the placeholder or body
    if (arButtonPlaceholder) {
        arButtonPlaceholder.innerHTML = '';
        arButtonPlaceholder.appendChild(startARButton);
        arButtonPlaceholder.style.display = 'block';
    } else {
        document.body.appendChild(startARButton);
    }
    
    document.getElementById('loading').style.display = 'none';
    
    // Start the animation loop
    animate();
    console.log("init() finished, animation loop started.");
}

function saveMesh() {
    if (!faceMesh || !faceMesh.visible) {
        console.warn("No visible face mesh to save yet.");
        return;
    }
    const exporter = new GLTFExporter();
    exporter.parse(
        faceMesh,
        function (gltfData) {
            console.log("Mesh exported to GLTF in memory.");
            exportedMeshData = gltfData;
            console.log("GLTF data (JSON object):", exportedMeshData);
            alert("Face mesh saved to memory! Ready for AR.");
        },
        function (error) {
            console.error('An error happened during GLTF export:', error);
        },
        { embedImages: true }
    );
}

let lastVideoTime = -1;

function animate() {
    requestAnimationFrame(animate);

    // If WebARRocks is running, let its helper manage its specific animations
    if (ARRocksInitialised) {
        WebARRocksObjectThreeHelper.animate();
    }
    
    render();
}

const _settings = {
  nDetectsPerLoop: 0,
  detectOptions: { isKeepTracking: true, isSkipConfirmation: false, thresholdDetectFactor: 1 },
  NNPath: './neuralNets/NN_KEYBOARD_5.json',
  scanSettings:{ nScaleLevels: 2, scale0Factor: 0.8, overlapFactors: [2, 2, 3], scanCenterFirst: true },
  isUseDeviceOrientation: true,
};

function render() {
    // Check our state to decide what to render
    if (ARRocksInitialised) {
        // --- AR MODE (WebARRocks) LOGIC ---
        // The WebARRocks helper handles the rendering, we just need to make sure
        // the scene background is transparent to see the video feed from its canvas.
        scene.background = null;
        renderer.setClearAlpha(0);

    } else {
        // --- NON-AR MODE (MediaPipe Face Tracking) LOGIC ---
        scene.background = new THREE.Color(0x333333);
        video.style.display = 'block';

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            let currentVideoTime = video.currentTime;
            if (currentVideoTime !== lastVideoTime) {
                lastVideoTime = currentVideoTime;
                const results = faceLandmarker.detectForVideo(video, performance.now());

                if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
                    faceMesh.visible = true;
                    debugCube.visible = false;
                    
                    const faceLandmarks = results.faceLandmarks[0];
                    const transformMatrix = results.facialTransformationMatrixes[0].data;
                    const positions = faceMesh.geometry.attributes.position.array;
                    
                    for (let i = 0; i < NUM_LANDMARKS; i++) {
                        positions[i * 3 + 0] = faceLandmarks[i].x;
                        positions[i * 3 + 1] = faceLandmarks[i].y;
                        positions[i * 3 + 2] = faceLandmarks[i].z;
                    }
                    
                    faceMesh.geometry.attributes.position.needsUpdate = true;
                    faceMesh.geometry.computeVertexNormals();
                    
                    const scaleFactor = 50;
                    const threeMatrix = new THREE.Matrix4().fromArray(transformMatrix);
                    threeMatrix.multiply(new THREE.Matrix4().makeScale(1, -1, 1));
                    threeMatrix.multiply(new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor));
                    faceMesh.matrix.copy(threeMatrix);
                    faceMesh.matrixAutoUpdate = false;
                    
                    drawFaceTexture(faceLandmarks, video.videoWidth, video.videoHeight);
                    faceTexture.needsUpdate = true;
                } else {
                    faceMesh.visible = false;
                    debugCube.visible = true;
                }
            }
        }
    }
    
    // The main renderer renders the scene in both modes.
    // In AR mode, it renders the 3D objects on top of the WebARRocks canvas.
    renderer.render(scene, camera);
}


function drawFaceTexture(faceLandmarks, videoWidth, videoHeight) {
    if (!textureCanvasCtx || !video) return;
    textureCanvasCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < NUM_LANDMARKS; i++) {
        const px = faceLandmarks[i].x * videoWidth;
        const py = faceLandmarks[i].y * videoHeight;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
    }
    const padding = (maxX - minX) * 0.2;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(videoWidth, maxX + padding);
    maxY = Math.min(videoHeight, maxY + padding);
    const cropWidth = maxX - minX;
    const cropHeight = maxY - minY;

    if (cropWidth <= 0 || cropHeight <= 0) return;

    textureCanvasCtx.save();
    textureCanvasCtx.drawImage(video, minX, minY, cropWidth, cropHeight, 0, 0, textureCanvas.width, textureCanvas.height);
    textureCanvasCtx.restore();
}

let _DOMVideo = null;

function mainWebARRocks(){
  // This flag is now the master control for switching to AR mode
  ARRocksInitialised = true; 
  _DOMVideo = document.getElementById('webcamVideo');

  // Stop the user-facing camera track before getting the environment-facing one
  if (video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
  }

  WebARRocksMediaStreamAPIHelper.get(_DOMVideo, initWebARRocks, (err) => {
      console.error('Cannot get video feed for WebARRocks:', err);
      alert('Could not access rear camera. Please ensure permissions are granted.');
      ARRocksInitialised = false; // Revert state if it fails
  }, {
    video: {
      width:  {min: 640, max: 1920, ideal: 1280},
      height: {min: 640, max: 1920, ideal: 720},
      facingMode: {ideal: 'environment'} // Use the back camera
    },
    audio: false
 });
}

function initWebARRocks(){
  const ARCanvas = document.getElementById('ARCanvas');
  const threeCanvas = document.getElementById('threeCanvas');
  
  // Make sure the canvases used by WebARRocks are ready
  ARCanvas.style.display = 'block';
  threeCanvas.style.display = 'block';
  
  WebARRocksObjectThreeHelper.init({
    video: _DOMVideo,
    ARCanvas: ARCanvas,    
    threeCanvas: threeCanvas,
    isFullScreen: true,
    NNPath: _settings.NNPath,
    callbackReady: function(){
      startWebARRocks();
      // Ensure canvases are fixed on top
      threeCanvas.style.position = 'fixed';
      ARCanvas.style.position = 'fixed';
    },
    isUseDeviceOrientation: _settings.isUseDeviceOrientation,
    loadNNOptions: _settings.loadNNOptions,
    nDetectsPerLoop: _settings.nDetectsPerLoop,
    detectOptions: _settings.detectOptions,
    cameraFov: _settings.cameraFov,
    scanSettings: _settings.scanSettings,
  });
}

function startWebARRocks(){
  // Now, try to load the saved face mesh.
  // If it exists, add it to the scene. If not, add a debug cube.
  if (exportedMeshData) {
      const loader = new GLTFLoader();
      const gltfJsonString = JSON.stringify(exportedMeshData);
      loader.parse(gltfJsonString, (gltf) => {
          const loadedMesh = gltf.scene;
          loadedMesh.scale.set(0.05, 0.05, 0.05); // Scale it down for AR
          console.log("Adding saved face mesh to WebARRocks tracker.");
          WebARRocksObjectThreeHelper.add('KEYBOARD', loadedMesh);
      });
  } else {
      console.warn("No saved face mesh found. Adding a debug cube instead.");
      const s = 0.5;
      const debugCubeAR = new THREE.Mesh(
          new THREE.BoxGeometry(s,s,s),
          new THREE.MeshNormalMaterial()
      );
      debugCubeAR.position.set(0, s/2, 0);
      WebARRocksObjectThreeHelper.add('KEYBOARD', debugCubeAR);
  }
}

// Start the initial (MediaPipe) setup
init();