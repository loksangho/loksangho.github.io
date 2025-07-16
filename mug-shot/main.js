// main.js - Hybrid Module Version

// Use import for module-based libraries
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { WebARRocksObjectThreeHelper } from './helpers/WebARRocksObjectThreeHelper.js';
import { WebARRocksMediaStreamAPIHelper } from './helpers/WebARRocksMediaStreamAPIHelper.js';

//window.THREE = THREE;


//import "https://raw.githack.com/AR-js-org/AR.js/master/three.js/build/ar.js";
 // Importing THREEx for AR.js



// These are global, loaded from face_mesh_data.js classic script
import { FACEMESH_TESSELATION, UV_COORDS } from './face_mesh_data.js';
const NUM_LANDMARKS = UV_COORDS.length;

// Global variables for the app
let scene, camera, renderer, video, faceLandmarker;
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let exportedMeshData = null;
let ARRocksInitialised = false;
const runningMode = "VIDEO";
let animationFrameId;
let markerRoot; 
let isWebARRocksRunning = false

const _settings = {
  nDetectsPerLoop: 0, // 0 -> adaptative

  loadNNOptions: {
    notHereFactor: 0.0,
    paramsPerLabel: {
      CUP: {
        thresholdDetect: 0.92
      }
    }
  },

  detectOptions: {
    isKeepTracking: true,
    isSkipConfirmation: false,
    thresholdDetectFactor: 1,
    cutShader: 'median',
    thresholdDetectFactorUnstitch: 0.2,
    trackingFactors: [0.5, 0.4, 1.5]
  },

  NNPath: './neuralNets/NN_COFFEE_2.json',

  cameraFov: 0, // In degrees, camera vertical FoV. 0 -> auto mode
  scanSettings:{
    nScaleLevels: 2,
    scale0Factor: 0.8,
    overlapFactors: [2, 2, 2], // between 0 (max overlap) and 1 (no overlap). Along X,Y,S
    scanCenterFirst: true    
  },

  followZRot: true,

  displayDebugCylinder: false
};

// Helper function to load a legacy script and return a promise
function loadLegacyScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve; // Resolve the promise when the script is loaded
        script.onerror = reject; // Reject on error
        document.head.appendChild(script);
    });
}

async function main() {
    window.THREE = THREE;
    try {
        await loadLegacyScript('https://raw.githack.com/AR-js-org/AR.js/master/three.js/build/ar-threex.js');
        console.log("ar-threex.js loaded successfully. THREEx is now available.");
        init();
    } catch (error) {
        console.error("Error loading ar-threex.js:", error);
    }
}

async function init() {
    console.log("init() started.");

    
        
    
    // Setup Scene for MediaPipe phase
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

    // Setup MediaPipe
    video = document.getElementById('webcamVideo');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });

    const visionResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(visionResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
        runningMode,
        numFaces: 1
    });

    // Setup Face Mesh object
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
    document.getElementById('loading').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'flex';
    document.getElementById('saveButton').addEventListener('click', saveMesh);
    document.getElementById('arButton').addEventListener('click', mainWebARRocks);

    // These listeners control the mode once AR has started
    document.getElementById('objectModeBtn').addEventListener('click', () => {
        // _DOMVideo is the global variable holding the video element
        startObjectTrackingMode(_DOMVideo);
    });

    document.getElementById('markerModeBtn').addEventListener('click', () => {
        startMarkerTrackingMode(_DOMVideo);
    });

    animate();
}

function saveArrayBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

//-----------------------------------------------------------------
// AR.JS INITIALIZATION
//-----------------------------------------------------------------
// Pass the 'three' object from the WebAR.rocks helper
// This function now handles waiting for the video to be ready.
function initializeArJs(video, three) {
    const { scene, camera, renderer } = three;

    const onPlaying = () => {
        // The video is now actively playing. Clean up the listener.
        video.removeEventListener('playing', onPlaying);
        
        console.log("Video is playing. Initializing AR.js source...");
        console.log("Video dimensions:", video.videoWidth, video.videoHeight);

        // 1. Initialize ArToolkitSource
        window.arToolkitSource = new window.THREEx.ArToolkitSource({
            sourceType: 'video',
            sourceElement: video
        });

        window.arToolkitSource.init(() => {
            // This is a critical step to ensure the AR.js processor
            // knows the video's size.
            window.arToolkitSource.onResizeElement();
            window.arToolkitSource.copySizeTo(renderer.domElement);
        });

        // 2. Initialize ArToolkitContext
        window.arToolkitContext = new window.THREEx.ArToolkitContext({
            cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
            detectionMode: 'mono',
        });

        window.arToolkitContext.init(() => {
            camera.projectionMatrix.copy(window.arToolkitContext.getProjectionMatrix());
        });

        // 3. Initialize Marker Controls
        markerRoot = new THREE.Group();
        scene.add(markerRoot);
        
        new window.THREEx.ArMarkerControls(window.arToolkitContext, markerRoot, {
            type: 'pattern',
            // ⬇️ CHANGE THIS LINE FOR THE TEST ⬇️
            patternUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/patt.hiro',
        });

        const arjsMesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1), // Using a simple cube for testing
            new THREE.MeshNormalMaterial({ transparent: true, opacity: 0.8 })
        );
        arjsMesh.position.y = 0.5;
        markerRoot.add(arjsMesh);
    };
    
    // Add the event listener. The callback will only run when the video starts playing.
    video.addEventListener('playing', onPlaying);
}


// arButton from your UI will now call this
function startObjectTrackingMode(videoElement) {
    cleanupARSystems(); // Clears any previous AR setup
    // Call your function that initializes WebARRocksObjectThreeHelper...
    initWebARRocks(videoElement);
}

function startMarkerTrackingMode(videoElement) {
    cleanupARSystems(); // Clears any previous AR setup
    // Call your function that initializes AR.js...
    startAROnlyTest(videoElement);
}

// In main.js
function cleanupARSystems() {
    // Stop any existing animation loop
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // Dispose of WebAR.rocks if it's running
    if (isWebARRocksRunning) {
        WebARRocksObjectThreeHelper.destroy();
        isWebARRocksRunning = false; // <-- RESET THE FLAG
        console.log("WebAR.rocks destroyed.");
    }

    // Dispose of AR.js context if it exists
    if (window.arToolkitContext) {
        window.arToolkitContext = null;
        console.log("AR.js context destroyed.");
    }
    
    // You might need to remove and re-add your canvas elements here
    // to ensure a clean state, but start with this.
}

function saveMesh() {
    const results = faceLandmarker.detectForVideo(video, performance.now());
    if (results.faceLandmarks.length === 0) {
        alert("No face detected. Please try again.");
        return;
    }

    const landmarks = results.faceLandmarks[0];
    const positions = faceMesh.geometry.attributes.position.array;
    for (let i = 0; i < landmarks.length; i++) {
        positions[i * 3]     = (landmarks[i].x - 0.5) * 2;
        positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
        positions[i * 3 + 2] = -landmarks[i].z;
    }
    faceMesh.geometry.attributes.position.needsUpdate = true;
    faceMesh.geometry.computeVertexNormals();

    const exporter = new GLTFExporter();
    exporter.parse(faceMesh, (gltf) => {
        exportedMeshData = gltf;
        alert("Face mesh saved! You can now start AR.");
        document.getElementById('arButton').style.display = 'block';
        document.getElementById('markerButton').style.display = 'block';

      //saveArrayBuffer(exportedMeshData, 'myFaceMesh.glb');
    }, (error) => console.error(error), { binary: true });
}


let lastVideoTime = -1;

function animate() {
    if (ARRocksInitialised) {
        // Stop this loop once AR starts; the AR helper has its own loop
        return;
    }
    animationFrameId = requestAnimationFrame(animate);
    render();
}

function render() {
    // This is the pre-AR rendering logic
    if (video && faceLandmarker && video.readyState === video.HAVE_ENOUGH_DATA) {
        if (video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            const results = faceLandmarker.detectForVideo(video, performance.now());

            if (results.faceLandmarks.length > 0) {
                faceMesh.visible = true; // Make the mesh visible

                const landmarks = results.faceLandmarks[0];
                const positions = faceMesh.geometry.attributes.position.array;
                const uvs = faceMesh.geometry.attributes.uv.array; // Get the UV buffer

                // Update vertex positions and UVs based on landmarks
                for (let i = 0; i < landmarks.length; i++) {
                    positions[i * 3]     = (landmarks[i].x - 0.5) * 2;
                    positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
                    positions[i * 3 + 2] = -landmarks[i].z;
                    
                    // --- ADDED: Update UV coordinates ---
                    uvs[i * 2]     = landmarks[i].x;
                    uvs[i * 2 + 1] = 1.0 - landmarks[i].y; // Flip Y for correct mapping
                }
                
                faceMesh.geometry.attributes.position.needsUpdate = true;
                faceMesh.geometry.attributes.uv.needsUpdate = true; // Flag the UV buffer for update
                faceMesh.geometry.computeVertexNormals();

                // Update the texture to show the camera feed on the mesh
                textureCanvasCtx.clearRect(0, 0, 512, 512);
                textureCanvasCtx.drawImage(video, 0, 0, 512, 512);
                faceTexture.needsUpdate = true;

            } else {
                faceMesh.visible = false; // Hide if no face is detected
            }
        }
    }

    // Render the scene in every frame
    renderer.render(scene, camera);
}

let _DOMVideo;
/*function mainWebARRocks() {

   // --- CRUCIAL CLEANUP STEP ---
    cancelAnimationFrame(animationFrameId);
    if (renderer) {
        renderer.dispose();
        console.log("Renderer disposed.");
    }
    if (scene) {
        scene.clear();
        console.log("Scene cleared.");
    }
    document.getElementById('outputCanvas').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'none';
    document.getElementById('webcamVideo').style.display = 'block';
    // --- END CLEANUP ---

    console.log("Cleanup finished. Starting AR."); // <-- Add this
  
    ARRocksInitialised = true;
    

    _DOMVideo = document.getElementById('webcamVideo');
    if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }
    
    // Access classic script helpers via the 'window' object

    WebARRocksMediaStreamAPIHelper.get(_DOMVideo, startAROnlyTest, function(err){
      throw new Error('Cannot get video feed ' + err);
    }, {
      video: {
        width:  {min: 640, max: 1920, ideal: 1280},
        height: {min: 640, max: 1920, ideal: 720},
        facingMode: {ideal: 'environment'}
      },
      audio: false
   });
}*/

// This function is called when the user wants to start AR
function mainWebARRocks() {
    // ... your cleanup code (canceling animation frame, etc.) ...

    _DOMVideo = document.getElementById('webcamVideo');
    if (_DOMVideo.srcObject) { 
        _DOMVideo.srcObject.getTracks().forEach(track => track.stop()); 
    }

    const successCallback = (videoElement) => {
        // SUCCESS! The rear camera is now on.
        console.log("Rear camera is active.");
        
        // --- Make the mode-switching buttons visible ---
        document.getElementById('arModeButtons').style.display = 'block';

        // Optionally, start one of the modes by default
        startObjectTrackingMode(videoElement); 
    };

    const errorCallback = (err) => {
        console.error("Could not get camera for AR mode:", err);
    };
    
    // Use the constraints array from the previous step
    WebARRocksMediaStreamAPIHelper.get(_DOMVideo, successCallback, errorCallback, {
      video: {
        width:  {min: 640, max: 1920, ideal: 1280},
        height: {min: 640, max: 1920, ideal: 720},
        facingMode: {ideal: 'environment'}
      },
      audio: false
   });
}

// This function will set up a clean scene just for the AR.js test.
function startAROnlyTest(videoElement) {
    console.log("Starting AR.js in isolated test mode.");

    const arScene = new THREE.Scene();
    const arCamera = new THREE.Camera();
    arScene.add(arCamera);
    
    const arRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });
    
    // --- FIX #1: Tell the renderer not to clear the background ---
    arRenderer.autoClear = false;
    
    arRenderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(arRenderer.domElement);
    
    // Initialize AR.js (This part is fine)
    window.arToolkitSource = new THREEx.ArToolkitSource({ sourceType: 'video', sourceElement: videoElement });
    window.arToolkitContext = new THREEx.ArToolkitContext({
        cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
        detectionMode: 'mono',
    });

    // We'll handle resizing in the animation loop instead of here
    arToolkitSource.init(() => {});
    
    arToolkitContext.init(() => {
        arCamera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());
    });

    // Marker Controls Setup (This part is fine)
    markerRoot = new THREE.Group();
    arScene.add(markerRoot);
    new THREEx.ArMarkerControls(arToolkitContext, markerRoot, {
        type: 'pattern',
        patternUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/patt.hiro',
    });
    const arjsMesh = new THREE.Mesh( new THREE.BoxGeometry(1,1,1), new THREE.MeshNormalMaterial() );
    arjsMesh.position.y = 0.5;
    markerRoot.add(arjsMesh);

    // --- FIX #2: Update the Animation Loop ---
    function animateTest() {
        requestAnimationFrame(animateTest);

        if (arToolkitSource.ready === false) return;

        // Ensure the renderer and AR source sizes are always in sync
        arToolkitSource.onResizeElement();
        arToolkitSource.copySizeTo(arRenderer.domElement);
        if (arToolkitContext.arController !== null) {
            arToolkitSource.copySizeTo(arToolkitContext.arController.canvas);
        }
        
        // This clears the depth buffer, but not the color, so the video remains
        arRenderer.clear();

        // Update AR.js, which also draws the video to the background
        arToolkitContext.update(arToolkitSource.domElement);

        // Render our 3D scene on top of the video
        arRenderer.render(arScene, arCamera);
    }
    animateTest();
}


function initWebARRocks(){
    const ARCanvas = document.getElementById('ARCanvas');
    const threeCanvas = document.getElementById('threeCanvas');
    
    WebARRocksObjectThreeHelper.init({
    video: _DOMVideo,
    ARCanvas: ARCanvas,
    threeCanvas: threeCanvas,
    NNPath: _settings.NNPath,
    callbackReady: startWebARRocks,
    loadNNOptions: _settings.loadNNOptions,
    nDetectsPerLoop: _settings.nDetectsPerLoop,
    detectOptions: _settings.detectOptions,
    cameraFov: _settings.cameraFov,
    followZRot: _settings.followZRot,
    scanSettings: _settings.scanSettings,
    isFullScreen: true,
    stabilizerOptions: {}
  });
}


function startWebARRocks(err, three) {
    if (err) {
        console.error("Error in WebAR.rocks initialization:", err);
        return;
    }
    isWebARRocksRunning = true;
    console.log("WebAR.rocks has initialized successfully.");
    initializeArJs(_DOMVideo, three);
    // Add lighting to the AR Scene
    three.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const arDirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    arDirLight.position.set(0, 1, 1);
    three.scene.add(arDirLight);

    if (exportedMeshData) {
        const loader = new GLTFLoader();

        // CORRECT: Pass an empty string for the path (2nd argument),
        // so your callback is the 3rd argument (onLoad).
        loader.parse(exportedMeshData, '', function (gltf) {
            const loadedMesh = gltf.scene;
            loadedMesh.scale.set(1, 1, 1);

            
            // Access classic script helper via the 'window' object
            WebARRocksObjectThreeHelper.add('CUP', loadedMesh);
             
        }, function (error) {
            console.error('An error happened during GLTF parsing:', error);
        });

    } else {
        // Fallback to a cube if no mesh was saved
        const arCube = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshNormalMaterial());
        WebARRocksObjectThreeHelper.add('CUP', arCube);
        alert("No mesh data found, showing a debug cube instead.");
    }

    // Start the new AR animation loop
    function animateAR() {
        requestAnimationFrame(animateAR);

        if (window.arToolkitContext && window.arToolkitSource && window.arToolkitSource.ready) {
            window.arToolkitContext.update(window.arToolkitSource.domElement);
            three.camera.projectionMatrix.copy(window.arToolkitContext.getProjectionMatrix());
            scene.visible = camera.visible; // Sync scene visibility with AR.js camera
        }

        if (markerRoot) {
            console.log('AR.js Marker Detected:', markerRoot.visible);
        }
        
        // Update WebAR.rocks (if initialized)
        if (WebARRocksObjectThreeHelper) {
            WebARRocksObjectThreeHelper.animate();
        }

        // Render the single, shared scene
        renderer.render(scene, camera);
        //WebARRocksObjectThreeHelper.animate();
        ;
    }
    animateAR();
}

// Start the application
main();
