import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

import { FACEMESH_TESSELATION, UV_COORDS } from './face_mesh_data.js';

let scene, camera, renderer;
let video, faceLandmarker, runningMode = "VIDEO";
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;

const NUM_LANDMARKS = UV_COORDS.length; // Ensure this is correct based on your UV_COORDS data

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

async function init() {
    // ... (rest of your init function remains the same) ...
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('outputCanvas') });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    camera.position.z = 100;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(0, 0, 1).normalize();
    scene.add(directionalLight);

    video = document.getElementById('webcamVideo');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve();
            };
        });
        video.width = VIDEO_WIDTH;
        video.height = VIDEO_HEIGHT;
        console.log("Webcam video started.");
    } catch (error) {
        console.error("Error accessing webcam:", error);
        document.getElementById('loading').innerText = "Error: Webcam access denied or failed.";
        return;
    }

    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        outputFaceBlendshapes: true,
        // *** IMPORTANT: Ensure this is true to get the transformation matrix! ***
        outputFacialTransformationMatrixes: true,
        runningMode: runningMode,
        numFaces: 1
    });

    document.getElementById('loading').style.display = 'none';

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(NUM_LANDMARKS * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const uvs = new Float32Array(NUM_LANDMARKS * 2);
    for (let i = 0; i < NUM_LANDMARKS; i++) {
        uvs[i * 2 + 0] = UV_COORDS[i].x;
        uvs[i * 2 + 1] = UV_COORDS[i].y;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const indices = new Uint16Array(FACEMESH_TESSELATION);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    geometry.morphAttributes.position = [];
    geometry.morphTargets = true;

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
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.1
    });

    faceMesh = new THREE.Mesh(geometry, material);
    scene.add(faceMesh);

    animate();
}

let lastVideoTime = -1;
async function animate() {
    requestAnimationFrame(animate);

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        if (lastVideoTime !== video.currentTime) {
            lastVideoTime = video.currentTime;
            const results = await faceLandmarker.detectForVideo(video, performance.now());

            // *** CRITICAL CHECK HERE ***
            if (results.faceLandmarks && results.faceLandmarks.length > 0 &&
                results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {

                const faceLandmarks = results.faceLandmarks[0];
                const blendshapes = results.faceBlendshapes && results.faceBlendshapes.length > 0 ? results.faceBlendshapes[0] : null;
                const transformMatrix = results.facialTransformationMatrixes[0].matrix;

                // 1. Update Mesh Positions using normalized landmarks
                const positions = faceMesh.geometry.attributes.position.array;
                for (let i = 0; i < NUM_LANDMARKS; i++) {
                    const landmark = faceLandmarks[i];
                    // MediaPipe landmarks are normalized (0-1).
                    // Convert them to a more suitable world coordinate scale for Three.js.
                    // (x - 0.5) * width/height adjusts for centering and aspect ratio.
                    // Scale factor 200 (adjust as needed, depending on your scene/camera setup)
                    positions[i * 3 + 0] = (landmark.x - 0.5) * VIDEO_WIDTH / 100;
                    positions[i * 3 + 1] = -(landmark.y - 0.5) * VIDEO_HEIGHT / 100; // Invert Y
                    positions[i * 3 + 2] = landmark.z * VIDEO_WIDTH / 100; // Z scaled
                }
                faceMesh.geometry.attributes.position.needsUpdate = true;
                faceMesh.geometry.computeVertexNormals();

                // 2. Apply Blendshapes (if you had a loaded GLTF model with morph targets)
                // This part remains mostly a placeholder for models with morph targets.
                // The `blendshapes` check is added to prevent errors if blendshapes aren't always present.
                if (blendshapes && faceMesh.morphTargetInfluences) {
                     for (const blendshape of blendshapes.categories) {
                         const { categoryName, score } = blendshape;
                         if (faceMesh.morphTargetDictionary && faceMesh.morphTargetDictionary[categoryName] !== undefined) {
                             faceMesh.morphTargetInfluences[faceMesh.morphTargetDictionary[categoryName]] = score;
                         }
                     }
                }

                // 3. Apply Transformation Matrix for global pose
                // Important: Adjust scale factor here to control the size of the mesh.
                // MediaPipe's matrix is in a relatively small scale.
                const scaleFactor = 150; // Experiment with this value (e.g., 50, 100, 200)

                const threeMatrix = new THREE.Matrix4().fromArray(transformMatrix);

                // Apply additional scale. Multiply from the right.
                threeMatrix.multiply(new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor));

                faceMesh.matrix.copy(threeMatrix);
                faceMesh.matrixAutoUpdate = false; // Keep this false after setting matrix directly
                faceMesh.matrixWorldNeedsUpdate = true; // Tell Three.js to recompute world matrix

                // Generate Face Texture
                drawFaceTexture(faceLandmarks, video.videoWidth, video.videoHeight);
                faceTexture.needsUpdate = true;

            } else {
                // No face detected, or matrices not available.
                // Optionally hide the mesh or display a message.
                faceMesh.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}

function drawFaceTexture(faceLandmarks, videoWidth, videoHeight) {
    if (!textureCanvasCtx || !video) return;

    textureCanvasCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < NUM_LANDMARKS; i++) {
        const landmark = faceLandmarks[i];
        const px = landmark.x * videoWidth;
        const py = landmark.y * videoHeight;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
    }

    const padding = (maxX - minX) * 0.1;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(videoWidth, maxX + padding);
    maxY = Math.min(videoHeight, maxY + padding);

    const cropWidth = maxX - minX;
    const cropHeight = maxY - minY;

    if (cropWidth <= 0 || cropHeight <= 0) {
        // If crop area is invalid, don't draw and potentially clear texture
        // textureCanvasCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
        return;
    }

    textureCanvasCtx.save();
    textureCanvasCtx.translate(textureCanvas.width, 0);
    textureCanvasCtx.scale(-1, 1);

    textureCanvasCtx.drawImage(
        video,
        minX, minY, cropWidth, cropHeight,
        0, 0, textureCanvas.width, textureCanvas.height
    );
    textureCanvasCtx.restore();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
