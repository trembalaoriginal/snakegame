const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app); // Cria a instância do servidor HTTP

// Configuração do CORS para o Express (principalmente se houver outras rotas RESTful)
// O origin deve ser a URL COMPLETA do seu frontend no Render.
// Removido o '/' no final da URL para evitar problemas de correspondência.
app.use(cors({
    origin: 'https://snakegame2-5r2n.onrender.com', // **ATENÇÃO: SUBSTITUA COM A URL REAL DO SEU FRONTEND NO RENDER!**
    methods: ['GET', 'POST']
}));

// Configuração do Socket.IO com CORS
const io = new Server(server, {
    cors: {
        origin: 'https://snakegame2-5r2n.onrender.com', // **ATENÇÃO: SUBSTITUA COM A URL REAL DO SEU FRONTEND NO RENDER!**
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
        console
