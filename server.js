const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors'); // Embora o CORS do Socket.IO seja prioritário, manteremos para qualquer requisição HTTP direta futura.

const app = express();
const server = http.createServer(app); // Cria a instância do servidor HTTP

// Configuração do CORS para o Express (principalmente se houver outras rotas RESTful)
// O origin deve ser a URL COMPLETA do seu frontend no Render.
// Removido o '/' no final da URL para evitar problemas de correspondência.
app.use(cors({
    origin: 'https://snakegame2-5r2n.onrender.com', // Substitua com a URL REAL do seu frontend no Render
    methods: ['GET', 'POST']
}));

// Configuração do Socket.IO com CORS
const io = new Server(server, {
    cors: {
        origin: 'https://snakegame2-5r2n.onrender.com', // Substitua com a URL REAL do seu frontend no Render
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3001; // Usar 3001 como padrão local, Render injetará a sua PORTA

// --- Configurações do Jogo ---
const MAP_WIDTH = 10000;
const MAP_HEIGHT = 10000;
const INITIAL_FOOD_COUNT = 300; // Quantidade inicial de comida no mapa
const FOOD_SIZE = 5; // Raio da comida
const SNAKE_SEGMENT_RADIUS = 10; // Raio de cada segmento da cobra (usado para cálculo de colisão)
const SNAKE_SPEED = 7; // Velocidade em pixels por tick
const TICK_RATE = 1000 / 30; // 30 atualizações por segundo (aproximadamente 33ms por tick)

let players = {}; // Objeto para armazenar todos os jogadores conectados
let foods = []; // Array para armazenar todas as comidas no mapa

// --- Funções Auxiliares de Jogo ---

/**
 * Gera uma nova comida em uma posição aleatória dentro do mapa.
 * @returns {object} Objeto representando a comida.
 */
function createFood() {
    return {
        id: Date.now() + Math.random(), // ID único para a comida
        x: Math.random() * MAP_WIDTH,
        y: Math.random() * MAP_HEIGHT,
        size: FOOD_SIZE
    };
}

/**
 * Gera um número especificado de comidas e as adiciona ao array de foods.
 * @param {number} count - O número de comidas a serem geradas.
 */
function generateFood(count) {
    for (let i = 0; i < count; i++) {
        foods.push(createFood());
    }
}

// Gera a quantidade inicial de comida ao iniciar o servidor
generateFood(INITIAL_FOOD_COUNT);

// --- Eventos do Socket.IO (Conexão e Comunicação com Clientes) ---

io.on('connection', (socket) => {
    console.log(`[CONNECTION] User connected: ${socket.id}`);

    // Evento 'start': Quando um jogador envia seu nome para iniciar o jogo
    socket.on('start', (name) => {
        // Validação básica do nome
        if (!name || name.trim() === '') {
            name = `Guest_${Math.floor(Math.random() * 1000)}`;
        }

        // Posição inicial aleatória para o jogador dentro dos limites do mapa
        // Garante que a cobra não comece na borda exata
        const startX = Math.random() * (MAP_WIDTH - SNAKE_SEGMENT_RADIUS * 2) + SNAKE_SEGMENT_RADIUS;
        const startY = Math.random() * (MAP_HEIGHT - SNAKE_SEGMENT_RADIUS * 2) + SNAKE_SEGMENT_RADIUS;

        players[socket.id] = {
            id: socket.id,
            name: name.substring(0, 15), // Limita o nome para 15 caracteres
            x: startX, // Apenas para referência inicial, a cobra usa snake[0].x/y
            y: startY,
            direction: 'right', // Direção inicial padrão
            snake: [{ x: startX, y: startY }], // A cabeça da cobra
            score: 0, // Pontuação inicial
            isAlive: true // Estado do jogador
        };

        // Envia o estado inicial do jogo apenas para o jogador que acabou de conectar
        socket.emit('init', {
            id: socket.id,
            players, // Estado de todos os jogadores (incluindo ele mesmo)
            foods,
            mapSize: { width: MAP_WIDTH, height: MAP_HEIGHT }
        });

        // Notifica os outros jogadores sobre o novo jogador
        socket.broadcast.emit('newPlayer', players[socket.id]);
        console.log(`[PLAYER] ${name} (${socket.id}) started the game.`);
    });

    // Evento 'move': Quando um jogador muda de direção
    socket.on('move', (data) => {
        const player = players[socket.id];
        if (player && player.isAlive) {
            // Previne que a cobra vire 180 graus instantaneamente (ex: de 'right' para 'left')
            const currentDirection = player.direction;
            if (data.direction === 'up' && currentDirection !== 'down') player.direction = 'up';
            else if (data.direction === 'down' && currentDirection !== 'up') player.direction = 'down';
            else if (data.direction === 'left' && currentDirection !== 'right') player.direction = 'left';
            else if (data.direction === 'right' && currentDirection !== 'left') player.direction = 'right';
        }
    });

    // Removido socket.on('update') pois o servidor agora tem seu próprio game loop

    // Evento 'disconnect': Quando um jogador se desconecta
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            console.log(`[DISCONNECT] User disconnected: ${players[socket.id].name} (${socket.id})`);
            delete players[socket.id]; // Remove o jogador da lista
            io.emit('playerDisconnected', socket.id); // Notifica todos os clientes
        } else {
            console.log(`[DISCONNECT] Unknown user disconnected: ${socket.id}`);
        }
    });
});

// --- Loop Principal do Jogo (Game Loop do Servidor) ---
// Este loop é responsável por atualizar o estado do jogo em intervalos regulares
setInterval(() => {
    // Itera sobre cada jogador para atualizar sua posição e verificar colisões
    for (const id in players) {
        const player = players[id];

        // Se o jogador não estiver vivo, pula sua atualização neste tick
        if (!player || !player.isAlive) {
            continue;
        }

        // Cria uma cópia da cabeça atual da cobra
        const head = { ...player.snake[0] };

        // Atualiza a posição da cabeça com base na direção
        if (player.direction === 'up') head.y -= SNAKE_SPEED;
        else if (player.direction === 'down') head.y += SNAKE_SPEED;
        else if (player.direction === 'left') head.x -= SNAKE_SPEED;
        else if (player.direction === 'right') head.x += SNAKE_SPEED;

        // Adiciona a nova cabeça ao array da cobra
        player.snake.unshift(head);

        let ateFood = false;
        // Verifica colisões da cabeça com as comidas
        // Itera de trás para frente para remover itens com segurança durante a iteração
        for (let i = foods.length - 1; i >= 0; i--) {
            const food = foods[i];
            const dist = Math.hypot(head.x - food.x, head.y - food.y);
            // Colisão se a distância entre os centros for menor que a soma dos raios
            if (dist < SNAKE_SEGMENT_RADIUS + food.size) {
                foods.splice(i, 1); // Remove a comida
                generateFood(1); // Gera uma nova comida para substituir
                ateFood = true;
                player.score += 1; // Aumenta a pontuação do jogador
                // Não remove o último segmento da cauda, fazendo a cobra crescer
                break; // A cobra só come uma comida por tick
            }
        }

        if (!ateFood) {
            // Se não comeu, remove o último segmento para manter o mesmo tamanho
            player.snake.pop();
        }

        // --- Verificações de Colisão (Se o jogador ainda estiver vivo após o movimento) ---

        // 1. Colisão com as paredes do mapa
        if (head.x < 0 || head.x > MAP_WIDTH || head.y < 0 || head.y > MAP
