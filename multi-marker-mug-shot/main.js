// main.js - Combined Simultaneous AR.js Player and WebARRocks

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FACEMESH_TESSELATION } from './face_mesh_data.js';

// Import WebARRocks helpers
import { WebARRocksObjectThreeHelper } from './helpers/WebARRocksObjectThreeHelper.js';
// We don't need the MediaStreamAPIHelper as we'll manage the stream manually

// Global variables
let scene, camera, renderer, video, faceLandmarker;
let exportedMeshData = null;
let animationFrameId;
let currentMode = null; // 'mediapipe', 'learner', 'player'

// AR specific variables
let arToolkitSource, arToolkitContext, multiMarkerControls, multiMarkerLearner;
const _settings = { NNPath: './neuralNets/NN_COFFEE_0.json' };

// Helper to load the legacy AR.js script
function loadLegacyScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => { window.THREE = THREE; resolve(); };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function main() {
    try {
        await loadLegacyScript('https://raw.githack.com/AR-js-org/AR.js/master/three.js/build/ar-threex.js');
        console.log("ar-threex.js loaded successfully.");
        initMediaPipe();
    } catch (error) {
        console.error("Error loading ar-threex.js:", error);
    }
}

// Phase 1: MediaPipe Face Capture
async function initMediaPipe() {
    currentMode = 'mediapipe';
    // ... This function is largely the same as the previous version ...
    // It sets up the initial scene, camera, renderer, video, and FaceLandmarker.
    
    // --- UI Setup for new flow ---
    document.getElementById('loading').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'flex';
    document.getElementById('phase1').style.display = 'block';

    document.getElementById('saveButton').addEventListener('click', saveMesh);
    document.getElementById('learnerButton').addEventListener('click', initLearner);

    const playerButton = document.getElementById('playerButton');
    const profileInput = document.getElementById('profileInput');
    profileInput.addEventListener('change', () => {
        playerButton.disabled = !profileInput.files.length;
    });
    playerButton.addEventListener('click', () => {
        const file = profileInput.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => initCombinedPlayer(JSON.parse(e.target.result));
            reader.readAsText(file);
        }
    });

    animate(); // Starts the MediaPipe render loop
}

function saveMesh() {
    // ... same as before ...
    // After saving, it now progresses the UI to the next phase.
    const exporter = new GLTFExporter();
    exporter.parse(faceMesh, (gltf) => {
        exportedMeshData = gltf;
        alert("Face mesh saved! Now, start the learner.");
        document.getElementById('phase1').style.display = 'none';
        document.getElementById('phase2').style.display = 'block';
    }, (error) => console.error(error), { binary: true });
}

// Universal cleanup function
function cleanup() {
    cancelAnimationFrame(animationFrameId);
    
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
        renderer = null;
    }

    if (currentMode === 'player') { // Check if we are cleaning up from combined mode
        WebARRocksObjectThreeHelper.destroy();
    }
    
    const dynamicUI = document.getElementById('dynamicUI');
    if(dynamicUI) dynamicUI.remove();

    document.getElementById('outputCanvas').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'none';
}


// Phase 2: AR.js Multi-Marker Learner
function initLearner() {
    cleanup();
    currentMode = 'learner';
    // ... This function is the same as the previous version ...
    // It sets up the learner, and on download, we manually advance the UI
    // Add a dynamic UI for this phase
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'dynamicUI';
    controlsContainer.style.cssText = 'position: absolute; top: 10px; left: 10px; z-index: 10; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 5px;';
    controlsContainer.innerHTML = `
        <button id="restartBtn">Restart Learning</button>
        <button id="downloadBtn">Download and Continue</button>
    `;
    document.body.appendChild(controlsContainer);
    document.getElementById('restartBtn').onclick = () => { multiMarkerLearner.reset(); alert('Learning restarted!'); };
    document.getElementById('downloadBtn').onclick = () => {
        multiMarkerLearner.toJSON(profileData => {
            const jsonString = JSON.stringify(profileData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'multiMarkerProfile.json';
            a.click();
            URL.revokeObjectURL(a.href);
            alert("Profile downloaded. Now please load it to start the combined AR.");
            
            // Restart UI to final phase
            cleanup();
            document.getElementById('uiContainer').style.display = 'flex';
            document.getElementById('phase1').style.display = 'none';
            document.getElementById('phase2').style.display = 'none';
            document.getElementById('phase3').style.display = 'block';
        });
    };
    
    animateAR(); // Starts the learner render loop
}


// Phase 3: Combined AR.js Player and WebARRocks
async function initCombinedPlayer(profileData) {
    cleanup();
    currentMode = 'player';

    // 1. --- Master Scene Setup ---
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.Camera(); // AR.js will manage this camera
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    scene.add(new THREE.DirectionalLight(0xffffff, 0.7));

    // 2. --- Shared Video Stream ---
    // We create ONE video element and get the camera stream ONCE.
    video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: {ideal: 1280}, height: {ideal: 720} }
    });
    video.srcObject = stream;
    document.body.appendChild(video);
    video.style.position = 'absolute';
    video.style.top = '0';
    video.style.left = '0';
    video.style.zIndex = '-1'; // Hide video behind canvas
    await new Promise(resolve => { video.onloadedmetadata = resolve; });
    video.play();


    // 3. --- Initialize AR.js (as master) ---
    // It uses our shared video element.
    arToolkitSource = new THREEx.ArToolkitSource({ sourceType: 'video', sourceElement: video });
    
    arToolkitSource.init(() => {
        arToolkitSource.onResizeElement();
        arToolkitSource.copyElementSizeTo(renderer.domElement);
    });

    arToolkitContext = new THREEx.ArToolkitContext({
        cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
        detectionMode: 'mono',
    });
    arToolkitContext.init(() => camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix()));
    
    // Setup multi-marker controls for AR.js
    const markerRoot = new THREE.Group();
    scene.add(markerRoot);
    multiMarkerControls = new THREEx.ArMultiMarkerControls(arToolkitContext, markerRoot, {
        multiMarkerFile: profileData
    });
    // Add an object for AR.js to track (e.g., a red box)
    const arjsObject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 'red' }));
    arjsObject.position.y = 0.5;
    markerRoot.add(arjsObject);


    // 4. --- Initialize WebARRocks (as slave) ---
    // It ALSO uses the shared video element, and we tell it to use our main scene.
    WebARRocksObjectThreeHelper.init({
        video: video,
        // We DON'T provide a separate canvas, letting it know it won't be managing rendering.
        NNPath: _settings.NNPath,
        callbackReady: (err, three) => {
            if (err) { console.error(err); return; }
            // Add the saved face mesh to the WebARRocks tracker
            if (exportedMeshData) {
                new GLTFLoader().parse(exportedMeshData, '', (gltf) => {
                    WebARRocksObjectThreeHelper.add('CUP', gltf.scene); // Label must match your NN
                });
            } else {
                 WebARRocksObjectThreeHelper.add('CUP', new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5), new THREE.MeshNormalMaterial()));
            }
            
            // Get the container for WebARRocks objects and add it to our main scene
            const webARrocksObjectsGroup = WebARRocksObjectThreeHelper.get_threeObject();
            scene.add(webARrocksObjectsGroup);
        }
    });
    
    // 5. --- Start Combined Animation Loop ---
    animateCombined();
}

function animateCombined() {
    if (currentMode !== 'player') return; // Ensure we only run in the correct mode

    animationFrameId = requestAnimationFrame(animateCombined);

    // Update AR.js - it processes the video and updates the markerRoot pose
    if (arToolkitSource && arToolkitSource.ready) {
        arToolkitContext.update(arToolkitSource.domElement);
    }
    
    // Update WebARRocks - it processes the video and updates its internal object poses
    WebARRocksObjectThreeHelper.animate();
    
    // Render the single, unified scene
    renderer.render(scene, camera);
}


// --- Other functions (animate, animateAR, renderMediaPipe) are needed for the first two phases ---
// These are mostly unchanged.
function animate() {
    if (currentMode !== 'mediapipe') return;
    animationFrameId = requestAnimationFrame(animate);
    renderMediaPipe();
}

function animateAR() {
    if (currentMode !== 'learner') return;
    animationFrameId = requestAnimationFrame(animateAR);
    if (!arToolkitSource || !arToolkitSource.ready) return;
    arToolkitContext.update(arToolkitSource.domElement);
    multiMarkerLearner.update();
    renderer.render(scene, camera);
}

// Stubs for functions that are large and unchanged, to keep this example clean.
// You should copy the full functions from the previous answer.
function renderMediaPipe() { /* ... Full function from previous answer ... */ }
// --- (End of stubs) ---

// Start the application
main();