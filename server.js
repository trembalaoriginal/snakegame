const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: '*' }
});
const cors = require('cors');
app.use(cors());

const PORT = process.env.PORT || 3001;

// Dimensões do mapa (dobro do Agar.io padrão)
const MAP_WIDTH = 10000;
const MAP_HEIGHT = 10000;

// Banco de dados em memória
let players = {};
let foods = [];

// Gerar comida no mapa
function generateFood(count) {
    for (let i = 0; i < count; i++) {
        foods.push({
            id: Date.now() + Math.random(),
            x: Math.random() * MAP_WIDTH,
            y: Math.random() * MAP_HEIGHT,
        });
    }
}
generateFood(500); // comida inicial

// Função para mover a cobra
function moveSnake(player) {
    const head = { ...player.snake[0] };
    const speed = 4 + Math.max(0, 10 - player.snake.length * 0.05);

    if (player.direction === 'up') head.y -= speed;
    if (player.direction === 'down') head.y += speed;
    if (player.direction === 'left') head.x -= speed;
    if (player.direction === 'right') head.x += speed;

    player.snake.unshift(head);

    // Checar colisão com comida
    let ateFood = false;
    for (let i = 0; i < foods.length; i++) {
        const food = foods[i];
        const dist = Math.hypot(head.x - food.x, head.y - food.y);
        if (dist < 15) {
            foods.splice(i, 1);
            generateFood(1);
            ateFood = true;
            break;
        }
    }

    if (!ateFood) {
        player.snake.pop();
    }

    // Limitar dentro do mapa
    head.x = Math.max(0, Math.min(MAP_WIDTH, head.x));
    head.y = Math.max(0, Math.min(MAP_HEIGHT, head.y));
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('start', (name) => {
        players[socket.id] = {
            id: socket.id,
            name,
            x: Math.random() * MAP_WIDTH,
            y: Math.random() * MAP_HEIGHT,
            direction: 'right',
            snake: [{
                x: Math.random() * MAP_WIDTH,
                y: Math.random() * MAP_HEIGHT,
            }]
        };
        socket.emit('init', { id: socket.id, players, foods, mapSize: { width: MAP_WIDTH, height: MAP_HEIGHT } });
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('move', (data) => {
        const player = players[socket.id];
        if (player) {
            player.direction = data.direction;
        }
    });

    socket.on('update', () => {
        const player = players[socket.id];
        if (player) {
            moveSnake(player);
            io.emit('state', { players, foods });
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

// Servir frontend (para Render)
app.use(express.static('public'));

http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
