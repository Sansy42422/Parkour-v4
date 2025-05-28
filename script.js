const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const heightDisplay = document.getElementById('heightDisplay');
const powerBarFill = document.getElementById('power-fill');
const powerText = document.getElementById('power-text');
// const startScreen = document.getElementById('start-screen'); // REMOVED
const gameOverScreen = document.getElementById('game-over-screen');
const finalHeightDisplay = document.getElementById('finalHeightDisplay');
const mobileControls = document.getElementById('mobile-controls');
const timeSlowOverlay = document.createElement('div');
timeSlowOverlay.id = 'time-slow-overlay';
document.getElementById('game-container').appendChild(timeSlowOverlay);


// Buttons
// const startGameButton = document.getElementById('startGameButton'); // REMOVED
const restartGameButton = document.getElementById('restartGameButton');
const leftButton = document.getElementById('leftButton');
const jumpButton = document.getElementById('jumpButton');
const rightButton = document.getElementById('rightButton');
const timeSlowButton = document.getElementById('timeSlowButton');

// Game Settings
canvas.width = 600;
canvas.height = 800;
const GRAVITY = 0.8;
const PLAYER_MAX_SPEED = 6;
const PLAYER_JUMP_FORCE = -16;
const PLATFORM_GAP_MIN_Y = 100; // Minimum vertical space between platforms
const PLATFORM_GAP_MAX_Y = 250; // Maximum vertical space
const PLATFORM_WIDTH_MIN = 80;
const PLATFORM_WIDTH_MAX = 200;
const PLATFORM_HORIZONTAL_BUFFER = 50; // Minimum horizontal distance between platforms
const CAMERA_SCROLL_THRESHOLD_Y = canvas.height * 0.4; // When player's Y (relative to camera) goes above this, camera scrolls
const FALL_THRESHOLD_Y = canvas.height + 100; // How far player can fall below the visible canvas before game over

// Time Slow Power Settings
const TIME_SLOW_DURATION = 180; // frames (approx 3 seconds at 60fps)
const TIME_SLOW_COOLDOWN = 600; // frames (approx 10 seconds)
const TIME_SLOW_FACTOR = 0.4; // 0.4 means 40% of normal game speed

let gameRunning = false;
let gameFrame = 0; // Tracks total frames for animations/timers

// Game Objects
let player = {};
let platforms = [];
let cameraY = 0; // Represents the global Y coordinate of the top-left corner of the visible canvas

// Time Slow Variables
let timeSlowActive = false;
let timeSlowTimer = 0;
let timeSlowCooldownTimer = 0; // Starts at 0, meaning it's initially ready
let gameSpeedMultiplier = 1; // Applied to gravity, platform scrolling, etc.

// Assets
const ASSET_PATHS = {
    player_idle: 'assets/player_idle.png',
    player_jump: 'assets/player_jump.png',
    platform_default: 'assets/platform_default.png',
    bg_layer1: 'assets/bg_layer1.png',   // Closer background elements (e.g., distant trees/mountains)
    bg_layer2: 'assets/bg_layer2.png',   // Mid-distance background (e.g., more distant mountains, clouds)
    bg_layer3: 'assets/bg_layer3.png',   // Farthest background (e.g., sky gradient or base clouds)
};

const images = {}; // Stores loaded Image objects

// Asset Loading Function
async function loadAssets() {
    const promises = [];
    for (const key in ASSET_PATHS) {
        const img = new Image();
        img.src = ASSET_PATHS[key];
        images[key] = img; // Store image object directly
        promises.push(new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = () => {
                console.warn(`Failed to load image: ${ASSET_PATHS[key]}. Using fallback color.`);
                images[key] = null; // Mark as failed to load
                resolve(); // Resolve anyway so game can start even with missing assets
            };
        }));
    }
    await Promise.all(promises);
    console.log("All assets loaded or failed gracefully.");
}

// --- Game Initialization ---
function initGame() {
    player = {
        x: canvas.width / 2 - 25,
        y: canvas.height - 100, // Starting near bottom of the canvas
        width: 50,
        height: 80,
        dx: 0,
        dy: 0,
        isJumping: false,
        heightReached: 0, // In game units (e.g., meters)
        state: 'idle', // For player sprite state
        keys: { left: false, right: false } // For continuous horizontal movement
    };

    platforms = [];
    cameraY = 0; // Reset camera to the very bottom of the game world (global Y 0)
    gameFrame = 0;

    timeSlowActive = false;
    timeSlowTimer = 0;
    timeSlowCooldownTimer = 0; // Initially ready
    gameSpeedMultiplier = 1;
    timeSlowOverlay.classList.remove('active'); // Ensure overlay is hidden
    updatePowerUI(); // Update UI to show READY state

    generateInitialPlatforms(); // Create the starting platforms

    gameRunning = true;
    showScreen(null); // Hide all UI screens to show the game canvas
    gameLoop(); // Start the game loop
}

// --- Player Functions ---
function drawPlayer() {
    // Determine which player image to draw based on state
    const img = images[player.state === 'jumping' || player.dy !== 0 ? 'player_jump' : 'player_idle'];
    if (img && img.complete && img.naturalWidth > 0) {
        // Draw image at player's position relative to the camera
        ctx.drawImage(img, player.x, player.y - cameraY, player.width, player.height);
    } else {
        // Fallback to drawing a colored rectangle if image fails to load
        ctx.fillStyle = '#ff6347'; // Tomato color
        ctx.fillRect(player.x, player.y - cameraY, player.width, player.height);
    }
}

function updatePlayer() {
    // Apply horizontal movement based on pressed keys
    if (player.keys.left) player.dx = -PLAYER_MAX_SPEED;
    else if (player.keys.right) player.dx = PLAYER_MAX_SPEED;
    else player.dx = 0;

    player.x += player.dx;

    // Apply gravity
    player.dy += GRAVITY * gameSpeedMultiplier; // Gravity is affected by time slow
    player.y += player.dy;

    // Keep player within horizontal canvas bounds
    if (player.x < 0) player.x = 0;
    if (player.x + player.width > canvas.width) player.x = canvas.width - player.width;

    // Check for falling off the screen (below camera's view)
    if (player.y - cameraY > FALL_THRESHOLD_Y) {
        endGame();
    }
}

function playerJump() {
    if (!player.isJumping) {
        player.dy = PLAYER_JUMP_FORCE;
        player.isJumping = true;
        player.state = 'jumping';
    }
}

// --- Platform Functions ---
function generateInitialPlatforms() {
    // Create a wide starting platform at the bottom
    platforms.push({ x: 0, y: canvas.height - 20, width: canvas.width, height: 20, type: 'start' });

    // Generate platforms upwards to fill the initial screen
    let currentY = canvas.height - 100; // Start generation above the starting platform
    for (let i = 0; i < 15; i++) { // Generate enough to fill initial screen and slightly beyond
        currentY -= (Math.random() * (PLATFORM_GAP_MAX_Y - PLATFORM_GAP_MIN_Y) + PLATFORM_GAP_MIN_Y);
        generatePlatformAtY(currentY);
    }
}

function generatePlatformAtY(y) {
    const width = Math.random() * (PLATFORM_WIDTH_MAX - PLATFORM_WIDTH_MIN) + PLATFORM_WIDTH_MIN;
    let x = Math.random() * (canvas.width - width); // Random X position within canvas width

    // Optional: Add logic to ensure platforms are reachable and not too clustered horizontally
    // For a basic "Only Up" game, simply generating them randomly is often sufficient
    // but we can add a simple check to spread them out a bit.
    if (platforms.length > 0) {
        const lastPlatform = platforms[platforms.length - 1]; // Get the last (lowest) platform
        const centerLast = lastPlatform.x + lastPlatform.width / 2;
        const centerNew = x + width / 2;

        // If the new platform is horizontally close to the last one (and vertically close too),
        // try to push it to the other side to encourage horizontal movement
        if (Math.abs(centerNew - centerLast) < PLATFORM_HORIZONTAL_BUFFER + Math.max(width, lastPlatform.width) / 2 &&
            Math.abs(y - lastPlatform.y) < PLATFORM_GAP_MIN_Y + 50) { // Only apply if somewhat vertically close
            if (centerNew < canvas.width / 2) {
                x = Math.random() * (canvas.width / 2 - width); // Try left half
            } else {
                x = canvas.width / 2 + Math.random() * (canvas.width / 2 - width); // Try right half
            }
            x = Math.max(0, Math.min(x, canvas.width - width)); // Ensure it's still in bounds
        }
    }


    platforms.push({
        x: x,
        y: y,
        width: width,
        height: 20, // All platforms have a fixed height
        type: 'normal' // Could add different types later (e.g., moving, crumbling)
    });
}


function updatePlatforms() {
    // Collision detection between player and platforms
    platforms.forEach(platform => {
        // Only check for collision if player is falling (dy > 0)
        if (player.dy > 0 && checkCollision(player, platform)) {
            // Player lands on platform
            player.dy = 0;
            player.y = platform.y - player.height; // Snap player to the top of the platform
            player.isJumping = false;
            player.state = 'idle'; // Reset player state to idle
        }
    });

    // Remove platforms that are far below the camera's view
    platforms = platforms.filter(platform => platform.y - cameraY < canvas.height + 50); // Keep platforms slightly off-screen for smooth transition

    // Generate new platforms as player goes up
    // Find the highest (lowest Y value) platform currently in the game world
    const highestPlatformY = platforms.reduce((minY, p) => Math.min(minY, p.y), canvas.height); // Initialize with canvas.height (bottom)
    
    // If the highest platform is still visible or just off-screen, generate more above it
    if (highestPlatformY - cameraY > -PLATFORM_GAP_MAX_Y) {
        generatePlatformAtY(highestPlatformY - (Math.random() * (PLATFORM_GAP_MAX_Y - PLATFORM_GAP_MIN_Y) + PLATFORM_GAP_MIN_Y));
    }
}

function drawPlatforms() {
    const platformImg = images['platform_default'];
    platforms.forEach(platform => {
        if (platformImg && platformImg.complete && platformImg.naturalWidth > 0) {
            // Draw image at platform's position relative to the camera
            ctx.drawImage(platformImg, platform.x, platform.y - cameraY, platform.width, platform.height);
        } else {
            // Fallback to colored rectangle
            ctx.fillStyle = '#8B4513'; // SaddleBrown
            ctx.fillRect(platform.x, platform.y - cameraY, platform.width, platform.height);
        }
    });
}

// --- Camera / Scrolling ---
function updateCamera() {
    // If player goes above a certain threshold (e.g., 40% from top of canvas),
    // scroll the camera upwards (i.e., decrease cameraY)
    if (player.y - cameraY < CAMERA_SCROLL_THRESHOLD_Y) {
        cameraY = player.y - CAMERA_SCROLL_THRESHOLD_Y;
    }
    // Calculate and update the height reached (score)
    // The player's height increases as cameraY decreases (player.y is global)
    player.heightReached = Math.max(player.heightReached, Math.floor((canvas.height - player.y) / 10)); // Convert game units to "meters"
}

// --- Time Slow Power ---
function activateTimeSlow() {
    // Only activate if not already active and cooldown is finished
    if (timeSlowCooldownTimer <= 0 && !timeSlowActive && gameRunning) {
        timeSlowActive = true;
        timeSlowTimer = TIME_SLOW_DURATION; // Set active duration
        gameSpeedMultiplier = TIME_SLOW_FACTOR; // Apply slow-down factor
        timeSlowOverlay.classList.add('active'); // Show visual effect
        powerText.textContent = 'Time Slow: ACTIVE!';
    }
}

function updatePowerUI() { // Added this function to simplify initial UI update
    if (timeSlowActive) {
        powerText.textContent = 'Time Slow: ACTIVE!';
        powerBarFill.style.backgroundColor = '#00f';
    } else if (timeSlowCooldownTimer > 0) {
        powerText.textContent = 'Time Slow: COOLDOWN';
        powerBarFill.style.backgroundColor = '#888';
    } else {
        powerText.textContent = 'Time Slow: READY';
        powerBarFill.style.backgroundColor = '#0f0';
    }
}

function updateTimeSlow() {
    if (timeSlowActive) {
        timeSlowTimer--;
        if (timeSlowTimer <= 0) {
            // Time slow duration ended
            timeSlowActive = false;
            timeSlowCooldownTimer = TIME_SLOW_COOLDOWN; // Start cooldown
            gameSpeedMultiplier = 1; // Reset game speed to normal
            timeSlowOverlay.classList.remove('active'); // Hide visual effect
            updatePowerUI(); // Update UI
        }
    } else {
        if (timeSlowCooldownTimer > 0) {
            timeSlowCooldownTimer--;
            updatePowerUI(); // Update UI
        } else if (powerText.textContent !== 'Time Slow: READY') { // Prevent constant DOM updates if already ready
            updatePowerUI(); // Cooldown finished
        }
    }

    // Update power bar UI to reflect active time or cooldown progress
    const progress = timeSlowActive ? (timeSlowTimer / TIME_SLOW_DURATION) :
                     (timeSlowCooldownTimer > 0 ? (1 - (timeSlowCooldownTimer / TIME_SLOW_COOLDOWN)) : 1);
    powerBarFill.style.width = `${progress * 100}%`;
}


// --- Utility Functions ---
// Basic AABB collision detection
function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawBackground() {
    // Always draw a base sky color
    ctx.fillStyle = '#87ceeb'; // Sky blue
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Parallax layers: draw multiple times to create a seamless looping effect
    const layers = [
        { img: images['bg_layer3'], speed: 0.1, yOffset: 0 },   // Farthest, slowest (e.g., distant sky patterns)
        { img: images['bg_layer2'], speed: 0.3, yOffset: -50 },  // Mid-distance
        { img: images['bg_layer1'], speed: 0.5, yOffset: -100 } // Closest, fastest (e.g., mountains, closer clouds)
    ];

    layers.forEach(layer => {
        if (layer.img && layer.img.complete && layer.img.naturalWidth > 0) {
            // Calculate how much the layer should scroll based on camera Y
            // The `%` operator makes it loop seamlessly once the image height is passed
            const scrollY = (cameraY * layer.speed) % layer.img.naturalHeight;

            // Draw the image at its current scrolled position
            ctx.drawImage(layer.img, 0, scrollY + layer.yOffset, canvas.width, layer.img.naturalHeight);
            // Draw a second copy above the first to create the seamless loop as it scrolls
            ctx.drawImage(layer.img, 0, scrollY + layer.yOffset - layer.img.naturalHeight, canvas.width, layer.img.naturalHeight);
        }
    });
}

function updateUI() {
    heightDisplay.textContent = player.heightReached;
}

// Manages which screen is visible (start, game, game over)
function showScreen(screenId) {
    const screens = [gameOverScreen]; // Only gameOverScreen is managed now
    screens.forEach(screen => screen.classList.remove('active')); // Hide all game screens

    if (screenId) { // If a specific screen ID is provided, show it
        document.getElementById(screenId).classList.add('active');
    }

    // Manage mobile controls visibility based on whether the game is actively running
    if (gameRunning) { // If gameRunning is true, show controls
        mobileControls.style.display = 'flex';
    } else { // If gameRunning is false (e.g., game over), hide controls
        mobileControls.style.display = 'none';
    }
}

// --- Main Game Loop ---
function gameLoop() {
    if (!gameRunning) return; // Stop loop if game is not running

    clearCanvas(); // Clear previous frame
    drawBackground(); // Draw background layers
    updatePlatforms(); // Update platform positions and handle collisions
    drawPlatforms(); // Draw platforms
    updatePlayer(); // Update player position and physics
    drawPlayer(); // Draw player
    updateCamera(); // Adjust camera based on player's height
    updateTimeSlow(); // Handle time slow power logic and cooldown
    updateUI(); // Update score/height display

    gameFrame++; // Increment frame counter
    requestAnimationFrame(gameLoop); // Request next animation frame
}

// --- Game State Management ---
function endGame() {
    gameRunning = false; // Stop the game loop
    finalHeightDisplay.textContent = player.heightReached; // Display final score
    showScreen('game-over-screen'); // Show game over screen
}

// --- Event Listeners ---
// startGameButton.addEventListener('click', initGame); // REMOVED
restartGameButton.addEventListener('click', initGame);

// Keyboard Controls (using `keydown` for continuous movement, `keyup` to stop)
const keys = {}; // Object to track currently pressed keys
window.addEventListener('keydown', (e) => {
    if (gameRunning) {
        if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') player.keys.left = true;
        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') player.keys.right = true;
        if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w' || e.key === ' ') {
            playerJump();
            e.preventDefault(); // Prevent page scrolling with arrow keys or spacebar
        }
        if (e.key.toLowerCase() === 'f' || e.key === 'Control') { // 'f' or 'Control' for time slow
            activateTimeSlow();
            e.preventDefault();
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (gameRunning) {
        if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') player.keys.left = false;
        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') player.keys.right = false;
        // Jump action does not need a keyup event to stop
    }
});

// Mobile Controls (using touchstart/touchend for continuous input)
leftButton.addEventListener('touchstart', (e) => { e.preventDefault(); player.keys.left = true; }, { passive: false });
leftButton.addEventListener('touchend', (e) => { e.preventDefault(); player.keys.left = false; });
rightButton.addEventListener('touchstart', (e) => { e.preventDefault(); player.keys.right = true; }, { passive: false });
rightButton.addEventListener('touchend', (e) => { e.preventDefault(); player.keys.right = false; });

jumpButton.addEventListener('touchstart', (e) => { e.preventDefault(); playerJump(); }, { passive: false });
timeSlowButton.addEventListener('touchstart', (e) => { e.preventDefault(); activateTimeSlow(); }, { passive: false });


// Initial setup: Load assets and then start the game immediately
loadAssets().then(() => {
    initGame(); // Directly start the game
});
