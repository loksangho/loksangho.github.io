// main.js - Combined with corrected THREEx loader

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FACEMESH_TESSELATION } from './face_mesh_data.js';
import { WebARRocksObjectThreeHelper } from './helpers/WebARRocksObjectThreeHelper.js';

// Global variables
let scene, camera, renderer, video, faceLandmarker;
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let exportedMeshData = null;
const runningMode = "VIDEO";
let animationFrameId;
let currentMode = null;

// AR specific variables
let arToolkitSource, arToolkitContext, multiMarkerControls, multiMarkerLearner;
const _settings = { NNPath: './neuralNets/NN_COFFEE_0.json' };

// --- CORRECTED SCRIPT LOADER ---
// This function now correctly sets window.THREE *before* the script loads.
function loadLegacyScript(url) {
    return new Promise((resolve, reject) => {
        // Make THREE globally available for the legacy script
        window.THREE = THREE;

        // --- PATCH FOR INCOMPATIBILITY ---
        // The ar-threex.js script is old and expects THREE.EventDispatcher.
        // This was removed in Three.js r125. We can polyfill it by pointing
        // to THREE.Object3D, which has the required event handling methods.
        if (!window.THREE.EventDispatcher) {
            window.THREE.EventDispatcher = THREE.Object3D;
        }
        // --- END OF PATCH ---

        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve; // The script can now find window.THREE when it executes
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function main() {
    try {
        await loadLegacyScript('https://raw.githack.com/AR-js-org/AR.js/master/three.js/build/ar-threex.js');
        console.log("ar-threex.js loaded successfully. THREEx is now defined.");
        initMediaPipe();
    } catch (error) {
        console.error("Error loading ar-threex.js:", error);
    }
}

// Phase 1: MediaPipe Face Capture
async function initMediaPipe() {
    currentMode = 'mediapipe';

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2.5;

    const canvas = document.getElementById('outputCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    canvas.style.display = 'block';

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(0, 1, 1);
    scene.add(dirLight);

    video = document.getElementById('webcamVideo');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });
    
    video.style.display = 'none';

    const visionResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(visionResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
        runningMode,
        numFaces: 1
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(478 * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(478 * 2), 2));
    geometry.setIndex(FACEMESH_TESSELATION.flat());
    
    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 512;
    textureCanvas.height = 512;
    textureCanvasCtx = textureCanvas.getContext('2d');
    faceTexture = new THREE.CanvasTexture(textureCanvas);
    
    const material = new THREE.MeshStandardMaterial({ map: faceTexture, side: THREE.DoubleSide });
    faceMesh = new THREE.Mesh(geometry, material);
    scene.add(faceMesh);

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

    animate();
}

function saveMesh() {
    if (currentMode !== 'mediapipe' || !faceLandmarker) return;
    const results = faceLandmarker.detectForVideo(video, performance.now());
    if (results.faceLandmarks.length === 0) {
        alert("No face detected. Please look at the camera.");
        return;
    }
    const exporter = new GLTFExporter();
    exporter.parse(faceMesh, (gltf) => {
        exportedMeshData = gltf;
        alert("Face mesh saved! Now, start the learner.");
        document.getElementById('phase1').style.display = 'none';
        document.getElementById('phase2').style.display = 'block';
    }, (error) => console.error(error), { binary: true });
}

function cleanup() {
    cancelAnimationFrame(animationFrameId);
    
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    if (renderer) {
        const domElement = renderer.domElement;
        if (domElement && domElement.parentElement) {
            domElement.parentElement.removeChild(domElement);
        }
        renderer.dispose();
        renderer = null;
    }

    if (currentMode === 'player') {
        WebARRocksObjectThreeHelper.destroy();
    }
    
    const dynamicUI = document.getElementById('dynamicUI');
    if(dynamicUI) dynamicUI.remove();

    document.getElementById('outputCanvas').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'none';
    const existingVideo = document.querySelector('video[playsinline]');
    if (existingVideo) existingVideo.remove();
}

function initLearner() {
    //cleanup();
    currentMode = 'learner';

    //renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    //renderer.setSize(window.innerWidth, window.innerHeight);
    //document.body.appendChild(renderer.domElement);

    //scene = new THREE.Scene();
    //camera = new THREE.Camera();
    //scene.add(camera);
    
    arToolkitSource = new THREEx.ArToolkitSource({ sourceType: 'webcam' });
    arToolkitSource.init(() => {
        setTimeout(() => {
            arToolkitSource.onResizeElement();
            arToolkitSource.copyElementSizeTo(renderer.domElement);
        }, 100);
    });

    arToolkitContext = new THREEx.ArToolkitContext({
        cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
        detectionMode: 'mono',
    });
    arToolkitContext.init(() => camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix()));
    
    multiMarkerLearner = new THREEx.ArMultiMarkerLearner(arToolkitContext);
    multiMarkerLearner.baseURL = "https://raw.githack.com/AR-js-org/AR.js/master/data/data/patt.";

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
            
            cleanup();
            document.getElementById('uiContainer').style.display = 'flex';
            document.getElementById('phase1').style.display = 'none';
            document.getElementById('phase2').style.display = 'none';
            document.getElementById('phase3').style.display = 'block';
        });
    };
    
    animateAR();
}

async function initCombinedPlayer(profileData) {
    cleanup();
    currentMode = 'player';

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.Camera();
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    scene.add(new THREE.DirectionalLight(0xffffff, 0.7));

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
    video.style.top = '0px';
    video.style.left = '0px';
    video.style.zIndex = '-1';
    await new Promise(resolve => { video.onloadedmetadata = resolve; });
    video.play();

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
    
    const markerRoot = new THREE.Group();
    scene.add(markerRoot);
    multiMarkerControls = new THREEx.ArMultiMarkerControls(arToolkitContext, markerRoot, {
        multiMarkerFile: profileData
    });
    const arjsObject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 'red' }));
    arjsObject.position.y = 0.5;
    markerRoot.add(arjsObject);

    WebARRocksObjectThreeHelper.init({
        video: video,
        NNPath: _settings.NNPath,
        callbackReady: (err, three) => {
            if (err) { console.error(err); return; }
            if (exportedMeshData) {
                new GLTFLoader().parse(exportedMeshData, '', (gltf) => {
                    WebARRocksObjectThreeHelper.add('CUP', gltf.scene);
                });
            } else {
                 WebARRocksObjectThreeHelper.add('CUP', new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5), new THREE.MeshNormalMaterial()));
            }
            const webARrocksObjectsGroup = WebARRocksObjectThreeHelper.get_threeObject();
            scene.add(webARrocksObjectsGroup);
        }
    });
    
    animateCombined();
}

function animateCombined() {
    if (currentMode !== 'player') return;
    animationFrameId = requestAnimationFrame(animateCombined);
    if (arToolkitSource && arToolkitSource.ready) {
        arToolkitContext.update(arToolkitSource.domElement);
    }
    WebARRocksObjectThreeHelper.animate();
    renderer.render(scene, camera);
}

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

let lastVideoTime = -1;
function renderMediaPipe() {
    if (video && faceLandmarker && video.readyState === video.HAVE_ENOUGH_DATA && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const results = faceLandmarker.detectForVideo(video, performance.now());

        if (results.faceLandmarks.length > 0) {
            faceMesh.visible = true;
            const landmarks = results.faceLandmarks[0];
            const positions = faceMesh.geometry.attributes.position.array;
            const uvs = faceMesh.geometry.attributes.uv.array;

            for (let i = 0; i < landmarks.length; i++) {
                positions[i * 3]     = (landmarks[i].x - 0.5) * 2;
                positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
                positions[i * 3 + 2] = -landmarks[i].z;
                uvs[i * 2]           = landmarks[i].x;
                uvs[i * 2 + 1]       = 1.0 - landmarks[i].y;
            }
            
            faceMesh.geometry.attributes.position.needsUpdate = true;
            faceMesh.geometry.attributes.uv.needsUpdate = true;
            faceMesh.geometry.computeVertexNormals();
            
            textureCanvasCtx.clearRect(0, 0, 512, 512);
            textureCanvasCtx.drawImage(video, 0, 0, 512, 512);
            faceTexture.needsUpdate = true;

        } else {
            faceMesh.visible = false;
        }
    }
    if (renderer) renderer.render(scene, camera);
}

main();