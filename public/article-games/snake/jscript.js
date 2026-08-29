// GAME_PIXEL_COUNT is the pixels on horizontal or vertical axis of the game board (SQUARE).
const GAME_PIXEL_COUNT = 40;
const SQUARE_OF_GAME_PIXEL_COUNT = Math.pow(GAME_PIXEL_COUNT, 2);

let totalFoodAte = 0;
let totalDistanceTravelled = 0;

/// THE GAME BOARD:
const gameContainer = document.getElementById("gameContainer");

const createGameBoardPixels = () => {
  let gamePixelDivs = '';
  for (let i = 1; i <= SQUARE_OF_GAME_PIXEL_COUNT; ++i) {
    gamePixelDivs = `${gamePixelDivs} <div class="gameBoardPixel" id="pixel${i}"></div>`;
  }
  // Populate the [#gameContainer] div with small div's representing game pixels
  gameContainer.innerHTML = `${gameContainer.innerHTML} ${gamePixelDivs}`;
};

// This variable always holds the updated array of game pixels created by createGameBoardPixels() :
const gameBoardPixels = document.getElementsByClassName("gameBoardPixel");

/// THE FOOD:
let currentFoodPostion = 0;
const createFood = () => {
  // Remove previous food;
  gameBoardPixels[currentFoodPostion].classList.remove("food");

  // Create new food
  currentFoodPostion = Math.random();
  currentFoodPostion = Math.floor(
    currentFoodPostion * SQUARE_OF_GAME_PIXEL_COUNT
  );
  gameBoardPixels[currentFoodPostion].classList.add("food");
};

/// THE SNAKE:

// Direction codes (Keyboard key codes for arrow keys):
const LEFT_DIR = 37;
const UP_DIR = 38;
const RIGHT_DIR = 39;
const DOWN_DIR = 40;
const WASD_TO_ARROW = { 65: LEFT_DIR, 87: UP_DIR, 68: RIGHT_DIR, 83: DOWN_DIR };

// Set snake direction initially to right
let snakeCurrentDirection = RIGHT_DIR;

const changeDirection = (newDirectionCode) => {
  if (gameOver) return;
  newDirectionCode = WASD_TO_ARROW[newDirectionCode] || newDirectionCode;
  // Change the direction of the snake
  if (newDirectionCode == snakeCurrentDirection) return;

  if (newDirectionCode == LEFT_DIR && snakeCurrentDirection != RIGHT_DIR) {
    snakeCurrentDirection = newDirectionCode;
  } else if (newDirectionCode == UP_DIR && snakeCurrentDirection != DOWN_DIR) {
    snakeCurrentDirection = newDirectionCode;
  } else if (
    newDirectionCode == RIGHT_DIR &&
    snakeCurrentDirection != LEFT_DIR
  ) {
    snakeCurrentDirection = newDirectionCode;
  } else if (newDirectionCode == DOWN_DIR && snakeCurrentDirection != UP_DIR) {
    snakeCurrentDirection = newDirectionCode;
  }
};

// Let the starting position of the snake be at the middle of game board
let currentSnakeHeadPosition = SQUARE_OF_GAME_PIXEL_COUNT / 2;

let gameOver = false;
let moveSnakeInterval = null;

const endGame = (reason) => {
  gameOver = true;
  if (moveSnakeInterval !== null) clearInterval(moveSnakeInterval);
  const panel = document.getElementById("gameOver");
  const message = document.getElementById("gameOverReason");
  if (message) message.textContent = reason;
  if (panel) panel.hidden = false;
};

// Initial snake length
let snakeLength = 1000;

// Move snake continously by calling this function repeatedly :
const moveSnake = () => {
  if (gameOver) return;
  let nextSnakeHeadPosition = currentSnakeHeadPosition;
  let isSnakeHeadOutOfBounds = false;

  switch (snakeCurrentDirection) {
    case LEFT_DIR:
      isSnakeHeadOutOfBounds = currentSnakeHeadPosition % GAME_PIXEL_COUNT === 0;
      nextSnakeHeadPosition -= 1;
      break;
    case UP_DIR:
      isSnakeHeadOutOfBounds = currentSnakeHeadPosition < GAME_PIXEL_COUNT;
      nextSnakeHeadPosition -= GAME_PIXEL_COUNT;
      break;
    case RIGHT_DIR:
      isSnakeHeadOutOfBounds = currentSnakeHeadPosition % GAME_PIXEL_COUNT === GAME_PIXEL_COUNT - 1;
      nextSnakeHeadPosition += 1;
      break;
    case DOWN_DIR:
      isSnakeHeadOutOfBounds = currentSnakeHeadPosition >= SQUARE_OF_GAME_PIXEL_COUNT - GAME_PIXEL_COUNT;
      nextSnakeHeadPosition += GAME_PIXEL_COUNT;
      break;
    default:
      break;
  }

  if (isSnakeHeadOutOfBounds || nextSnakeHeadPosition < 0 || nextSnakeHeadPosition >= SQUARE_OF_GAME_PIXEL_COUNT) {
    endGame("撞到边界了");
    return;
  }

  currentSnakeHeadPosition = nextSnakeHeadPosition;

  let nextSnakeHeadPixel = gameBoardPixels[currentSnakeHeadPosition];

  // Kill snake if it bites itself:
  if (nextSnakeHeadPixel.classList.contains("snakeBodyPixel")) {
    endGame("撞到自己了");
    return;
  }

  nextSnakeHeadPixel.classList.add("snakeBodyPixel");

  setTimeout(() => {
    nextSnakeHeadPixel.classList.remove("snakeBodyPixel");
  }, snakeLength);

  // Update total distance travelled
  totalDistanceTravelled++;
  // Update in UI:
  document.getElementById("blocksTravelled").innerHTML = totalDistanceTravelled;

  if (currentSnakeHeadPosition == currentFoodPostion) {
    // Update total food ate
    totalFoodAte++;
    // Update in UI:
    document.getElementById("pointsEarned").innerHTML = totalFoodAte;

    // Increase Snake length:
    snakeLength = snakeLength + 100;
    createFood();
  }
};

/// CALL THE FOLLOWING FUNCTIONS TO RUN THE GAME:

// Create game board pixels:
createGameBoardPixels();

// Create initial food:
createFood();

// Move snake:
moveSnakeInterval = setInterval(moveSnake, 80);

// Call change direction function on keyboard key-down event:
addEventListener("keydown", (e) => changeDirection(e.keyCode));

// ON SCREEN CONTROLLERS:
const leftButton = document.getElementById("leftButton");
const rightButton = document.getElementById("rightButton");
const upButton = document.getElementById("upButton");
const downButton = document.getElementById("downButton");

leftButton.onclick = () => changeDirection(LEFT_DIR);
rightButton.onclick = () => changeDirection(RIGHT_DIR);
upButton.onclick = () => changeDirection(UP_DIR);
downButton.onclick = () => changeDirection(DOWN_DIR);

const restartButton = document.getElementById("restartButton");
if (restartButton) restartButton.onclick = () => window.location.reload();
