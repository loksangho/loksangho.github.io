import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let scene, camera, renderer;
let video, faceLandmarker, runningMode = "VIDEO";
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;

// MediaPipe Face Mesh Tesselation and UV coordinates (simplified example)
// In a real project, you'd import these from MediaPipe's utilities.
// For now, we'll use a placeholder and conceptually refer to them.
// You'll need to get the actual FACEMESH_TESSELATION and UV_COORDS from MediaPipe's source or examples.
// Example: https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/face_geometry_uv_image_grid.png
// The actual UV coordinates are often found in `@mediapipe/face_mesh` or related TFJS models.
// For a complete solution, you'd typically have a `face_mesh_coords.js` or similar file.

// Placeholder for UV coordinates and triangulation (YOU NEED TO GET THE REAL ONES)
// This is critical. MediaPipe's Face Landmarker provides 478 landmarks.
// You need the UV coordinates for each of these 478 points, and the triangulation
// (indices of vertices that form each triangle) for the standard MediaPipe face mesh.
// Search for `FACEMESH_TESSELATION` and `FACEMESH_UV_COORDS` or similar in MediaPipe examples.
// A common place is in the `@tensorflow-models/face-landmarks-detection` package or MediaPipe's own demos.
// For demonstration purposes, let's imagine we have them:
import { FACEMESH_TESSELATION, FACEMESH_FACE_OVAL, UV_COORDS } from './face_mesh_data.js'; // You'll create this file

const NUM_LANDMARKS = 468; // Or 478 if using the latest model with irises
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

async function init() {
    // 1. Setup Three.js Scene
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('outputCanvas') });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    camera.position.z = 2; // Adjust based on the scale of your mesh

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // Add directional light for better shading
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(0, 1, 1).normalize();
    scene.add(directionalLight);

    // 2. Setup Webcam Video
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

    // 3. Initialize MediaPipe Face Landmarker
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU" // Try "CPU" if GPU causes issues
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: runningMode,
        numFaces: 1 // Track only one face for simplicity
    });

    document.getElementById('loading').style.display = 'none';

    // 4. Create Three.js Face Mesh (Geometry)
    // The geometry's vertex count will be 478.
    // The topology (indices) is fixed by MediaPipe's FACEMESH_TESSELATION.
    const geometry = new THREE.BufferGeometry();

    // Vertices (positions)
    const positions = new Float32Array(NUM_LANDMARKS * 3); // x, y, z for each landmark
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // UVs (texture coordinates)
    // The UV_COORDS array should have NUM_LANDMARKS * 2 values (u, v for each landmark)
    const uvs = new Float32Array(UV_COORDS); // Assuming UV_COORDS is available from face_mesh_data.js
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    // Indices (triangles)
    // The FACEMESH_TESSELATION array defines the triangles (e.g., [v1, v2, v3, v4, v5, v6, ...])
    const indices = new Uint16Array(FACEMESH_TESSELATION.flat()); // Flatten the array of triangle indices
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    geometry.computeVertexNormals(); // For proper lighting

    // 5. Create Texture Canvas
    // This canvas will be where we "draw" the warped face texture.
    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 256; // Standard texture size, power of 2
    textureCanvas.height = 256;
    textureCanvasCtx = textureCanvas.getContext('2d');

    faceTexture = new THREE.CanvasTexture(textureCanvas);
    faceTexture.minFilter = THREE.LinearFilter;
    faceTexture.magFilter = THREE.LinearFilter;
    faceTexture.encoding = THREE.sRGBEncoding;

    // 6. Create Three.js Material
    const material = new THREE.MeshStandardMaterial({
        map: faceTexture,
        side: THREE.DoubleSide, // Render both sides of the mesh
        // wireframe: true // Uncomment for wireframe view
    });

    // 7. Create Three.js Mesh
    faceMesh = new THREE.Mesh(geometry, material);
    scene.add(faceMesh);

    // Initial positioning of the mesh
    // We'll update this in the animation loop based on MediaPipe's transform matrix.
    faceMesh.position.set(0, 0, 0);

    // Start the animation loop
    animate();
}

let lastVideoTime = -1;
async function animate() {
    requestAnimationFrame(animate);

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        if (lastVideoTime !== video.currentTime) {
            lastVideoTime = video.currentTime;
            const results = await faceLandmarker.detectForVideo(video, performance.now());
            
            if (results.faceLandmarks && results.faceLandmarks.length > 0) {
                const faceLandmarks = results.faceLandmarks[0];
                const blendshapes = results.faceBlendshapes[0];
                const transformMatrix = results.facialTransformationMatrixes[0].matrix; // MediaPipe matrix is column-major

                // Update Mesh Positions
                const positions = faceMesh.geometry.attributes.position.array;
                for (let i = 0; i < NUM_LANDMARKS; i++) {
                    const landmark = faceLandmarks[i];
                    // MediaPipe landmarks are normalized (0-1) relative to video size.
                    // We need to convert them to Three.js world coordinates.
                    // A simple scaling/offset can work, but the transform matrix is better.
                    // For now, let's just use the raw coordinates for a direct mapping,
                    // and rely on the transform matrix for global pose.
                    positions[i * 3 + 0] = landmark.x * VIDEO_WIDTH / 100 - VIDEO_WIDTH / 200; // Adjust for aspect ratio and center
                    positions[i * 3 + 1] = -(landmark.y * VIDEO_HEIGHT / 100 - VIDEO_HEIGHT / 200); // Invert Y and adjust
                    positions[i * 3 + 2] = landmark.z * VIDEO_WIDTH / 100; // Z is relative depth

                    // A more robust approach involves converting MediaPipe's normalized coordinates
                    // to clip space, then inverse projecting to world space, or applying the
                    // facial transformation matrix directly to a canonical mesh.
                    // For now, we'll let the transform matrix handle the global pose.
                }
                faceMesh.geometry.attributes.position.needsUpdate = true;
                faceMesh.geometry.computeVertexNormals(); // Recalculate normals after position update

                // Apply Blendshapes
                if (blendshapes && faceMesh.geometry.morphTargets) {
                    for (const blendshape of blendshapes.categories) {
                        const { categoryName, score } = blendshape;
                        // Map MediaPipe blendshape names to your morph target names
                        // (You need to ensure your 3D model's morph targets match MediaPipe's categories)
                        if (faceMesh.morphTargetDictionary && faceMesh.morphTargetDictionary[categoryName] !== undefined) {
                            faceMesh.morphTargetInfluences[faceMesh.morphTargetDictionary[categoryName]] = score;
                        }
                    }
                }
                // *** IMPORTANT BLENDSHAPE NOTE ***
                // To use blendshapes effectively, you typically need a pre-modeled 3D face with morph targets
                // (shape keys in Blender) corresponding to MediaPipe's blendshape categories.
                // You would load this GLTF/GLB model into Three.js, and then update its `morphTargetInfluences`
                // array directly from MediaPipe's `blendshapes.categories`.
                // The `geometry.morphTargets` approach used above is for a dynamic mesh.
                // If you are loading a glTF, you'd do:
                // `gltfMesh.morphTargetInfluences[gltfMesh.morphTargetDictionary[categoryName]] = score;`

                // Apply Transformation Matrix
                const matrix = new THREE.Matrix4();
                // MediaPipe's matrix is column-major, Three.js is also column-major.
                // Direct assignment should work if the scale is correct.
                // However, MediaPipe's output might need some adjustments to match Three.js coordinate system.
                // A common adjustment is to negate the Z-axis for right-handed to left-handed conversion.
                // Or to account for flipped video input.
                matrix.set(
                    transformMatrix[0], -transformMatrix[1], transformMatrix[2], transformMatrix[3], // Adjust Y
                    -transformMatrix[4], transformMatrix[5], -transformMatrix[6], transformMatrix[7], // Adjust X and Z
                    transformMatrix[8], -transformMatrix[9], transformMatrix[10], transformMatrix[11], // Adjust Y and Z
                    transformMatrix[12], transformMatrix[13], transformMatrix[14], transformMatrix[15]
                );
                // A simpler alternative for initial testing:
                // faceMesh.position.set(faceLandmarks[0].x * window.innerWidth / 1000, -faceLandmarks[0].y * window.innerHeight / 1000, 0);
                // faceMesh.rotation.y = someCalculatedYawFromMatrix;
                // faceMesh.rotation.x = someCalculatedPitchFromMatrix;
                // faceMesh.rotation.z = someCalculatedRollFromMatrix;

                // For direct matrix application, you might need to inverse the camera perspective or scale.
                // A common pattern is to multiply the MediaPipe matrix by a transformation that converts
                // MediaPipe's normalized image space to Three.js world space.
                // Let's use a simpler pose update for this example, or just let Three.js handle it if the model is correctly scaled.
                // If you're applying the raw landmarks, the matrix might be used to position the *camera* relative to the face.
                // For a static camera and moving mesh:
                // The `transformMatrix` transforms from the *canonical* MediaPipe face model to the current estimated face.
                // You apply this matrix directly to your `faceMesh` if your `faceMesh` is initially defined as the canonical model.
                // faceMesh.matrixAutoUpdate = false;
                // faceMesh.matrix.fromArray(transformMatrix);
                // faceMesh.matrixWorldNeedsUpdate = true; // For matrix updates.

                // For now, let's keep it simple and just update the positions directly.
                // The transformation matrix is usually applied to an *entire model* that's already in a canonical pose.
                // If you're generating the mesh vertices directly from `faceLandmarks`, you're already updating the pose.
                // The `transformMatrix` is more useful for aligning external 3D objects with the face.

                // Generate Face Texture
                drawFaceTexture(faceLandmarks);
                faceTexture.needsUpdate = true;
            }
        }
    }

    renderer.render(scene, camera);
}

// Function to draw the warped face texture onto the textureCanvas
function drawFaceTexture(faceLandmarks) {
    if (!textureCanvasCtx || !video) return;

    textureCanvasCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);

    // This is the most complex part: Projecting the 2D video image onto the 2D UV map.
    // It involves an inverse mapping from UV space to pixel space in the video.
    // A common technique is to use `cv2.remap` in OpenCV, but in pure JS, it's more involved.
    // We'll iterate through the triangles of the face mesh.

    // A simpler approximation: Draw the video directly onto the texture canvas,
    // then use the UVs to map *parts* of it. This isn't truly "warped," but it's a start.
    // For a proper warped texture, you'd need to compute barycentric coordinates or
    // implement a texture mapping algorithm that takes the UVs and the 3D landmark
    // positions to sample the correct pixels from the `video` element.

    // A common simplified approach is to get a rough crop and rely on the UV map
    // in Three.js to pull the correct pixels.
    // However, for precise face texture, you need to "unwarp" the face.
    // There are libraries/shaders that can help with this.

    // **Simplified Texture Drawing (Not truly warped):**
    // This will just draw the whole video to the texture canvas. The UVs will then
    // pull segments from this unwarped texture. This will look stretched.
    // To get a properly "unwarped" texture, you need advanced image processing.
    //
    // For a basic visual test, let's just draw a cropped region of the face to the texture:
    const minX = Math.min(...faceLandmarks.map(l => l.x)) * video.videoWidth;
    const minY = Math.min(...faceLandmarks.map(l => l.y)) * video.videoHeight;
    const maxX = Math.max(...faceLandmarks.map(l => l.x)) * video.videoWidth;
    const maxY = Math.max(...faceLandmarks.map(l => l.y)) * video.videoHeight;

    const cropX = Math.max(0, minX - (maxX - minX) * 0.1); // Add some padding
    const cropY = Math.max(0, minY - (maxY - minY) * 0.1);
    const cropWidth = Math.min(video.videoWidth - cropX, (maxX - minX) * 1.2);
    const cropHeight = Math.min(video.videoHeight - cropY, (maxY - minY) * 1.2);

    // Flip the video horizontally for natural viewing
    textureCanvasCtx.save();
    textureCanvasCtx.scale(-1, 1);
    textureCanvasCtx.translate(-textureCanvas.width, 0);
    textureCanvasCtx.drawImage(
        video,
        cropX, cropY, cropWidth, cropHeight, // Source rectangle
        0, 0, textureCanvas.width, textureCanvas.height // Destination rectangle
    );
    textureCanvasCtx.restore();

    // To do a *proper* texture warp, you'd need to:
    // 1. Get the 2D pixel coordinates of each landmark from the video frame.
    //    (Convert normalized x, y from MediaPipe results to actual pixels)
    // 2. Iterate through each triangle defined by `FACEMESH_TESSELATION`.
    // 3. For each triangle, get its 3D landmark points and their corresponding 2D UV points.
    // 4. Use a method like `textureCanvasCtx.drawImage` with source and destination arrays,
    //    or a custom shader that performs the texture lookup based on the UVs.
    //    This often involves inverse barycentric coordinates or a more complex affine transformation per triangle.
    // This is often handled by a custom shader for performance or a pre-built library.

    // For now, this rough crop is a starting point. The UVs in Three.js will then map this
    // (potentially stretched) texture onto the 3D mesh.
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
