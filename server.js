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
        if (head.x < 0 || head.x > MAP_WIDTH || head.y < 0 || head.y > MAP_HEIGHT) {
            player.isAlive = false;
            io.to(player.id).emit('gameOver', 'Você colidiu com a parede!');
            console.log(`[GAME OVER] ${player.name} (${player.id}) colidiu com a parede.`);
        }

        // 2. Colisão com o próprio corpo (a partir do terceiro segmento para evitar bugs na virada)
        if (player.snake.length > 3) {
            for (let i = 3; i < player.snake.length; i++) {
                const segment = player.snake[i];
                const dist = Math.hypot(head.x - segment.x, head.y - segment.y);
                if (dist < SNAKE_SEGMENT_RADIUS * 0.8) { // Usar um raio ligeiramente menor para evitar detecções falsas
                    player.isAlive = false;
                    io.to(player.id).emit('gameOver', 'Você colidiu com seu próprio corpo!');
                    console.log(`[GAME OVER] ${player.name} (${player.id}) colidiu com o próprio corpo.`);
                    break;
                }
            }
        }

        // 3. Colisão com outras cobras
        // Se o jogador já morreu (ex: por parede ou próprio corpo), não precisa verificar colisão com outros jogadores
        if (!player.isAlive) continue;

        for (const otherId in players) {
            if (otherId === player.id) continue; // Ignora o próprio jogador

            const otherPlayer = players[otherId];

            // Ignora jogadores que não estão vivos
            if (!otherPlayer || !otherPlayer.isAlive) continue;

            const otherHead = otherPlayer.snake[0];

            // Colisão da cabeça do jogador atual com a cabeça de outro jogador
            const distHeads = Math.hypot(head.x - otherHead.x, head.y - otherHead.y);
            if (distHeads < SNAKE_SEGMENT_RADIUS * 2) { // Colisão de cabeça com cabeça (soma dos raios)
                // Lógica de quem "ganha" na colisão de cabeça
                if (player.score > otherPlayer.score) {
                    // Jogador atual é maior, "come" o outro jogador
                    otherPlayer.isAlive = false;
                    io.to(otherId).emit('gameOver', `Você foi comido por ${player.name}!`);
                    player.score += Math.floor(otherPlayer.score / 2); // Ganha metade da pontuação do outro
                    console.log(`[COLLISION] ${player.name} (${player.id}) comeu ${otherPlayer.name} (${otherId}).`);
                } else if (otherPlayer.score > player.score) {
                    // Outro jogador é maior, "come" o jogador atual
                    player.isAlive = false;
                    io.to(player.id).emit('gameOver', `Você foi comido por ${otherPlayer.name}!`);
                    otherPlayer.score += Math.floor(player.score / 2);
                    console.log(`[COLLISION] ${otherPlayer.name} (${otherId}) comeu ${player.name} (${player.id}).`);
                } else {
                    // Ambos têm o mesmo tamanho ou colisão mútua, ambos morrem
                    player.isAlive = false;
                    otherPlayer.isAlive = false;
                    io.to(player.id).emit('gameOver', `Você colidiu com ${otherPlayer.name}!`);
                    io.to(otherId).emit('gameOver', `Você colidiu com ${player.name}!`);
                    console.log(`[COLLISION] ${player.name} (${player.id}) e ${otherPlayer.name} (${otherId}) colidiram igualmente.`);
                }
            }

            // Colisão da cabeça do jogador atual com o CORPO de outro jogador
            if (!player.isAlive) continue; // Se o jogador já morreu, não verifica mais colisões

            for (let i = 1; i < otherPlayer.snake.length; i++) { // Começa do segundo segmento do corpo do outro jogador
                const otherSegment = otherPlayer.snake[i];
                const distBody = Math.hypot(head.x - otherSegment.x, head.y - otherSegment.y);
                if (distBody < SNAKE_SEGMENT_RADIUS * 0.8) { // Colisão com segmento do corpo
                    player.isAlive = false;
                    io.to(player.id).emit('gameOver', `Você colidiu com o corpo de ${otherPlayer.name}!`);
                    console.log(`[GAME OVER] ${player.name} (${player.id}) colidiu com o corpo de ${otherPlayer.name}.`);
                    break;
                }
            }
        }
    }

    // --- Pós-processamento do Game Loop ---

    // Remove jogadores que morreram para não aparecerem mais no mapa
    const alivePlayers = {};
    for (const id in players) {
        if (players[id].isAlive) {
            alivePlayers[id] = players[id];
        }
    }
    players = alivePlayers; // Atualiza a lista de jogadores ativos

    // Garante que sempre haja a quantidade inicial de comida no mapa
    if (foods.length < INITIAL_FOOD_COUNT) {
        generateFood(INITIAL_FOOD_COUNT - foods.length);
    }

    // Envia o estado atualizado do jogo para TODOS os clientes conectados
    io.emit('state', { players, foods });

}, TICK_RATE); // Executa o loop a cada TICK_RATE milissegundos

// --- Inicia o Servidor HTTP ---
// Esta é a linha onde o servidor HTTP (armazenado em 'server') é iniciado
server.listen(PORT, () => {
    console.log(`Server rodando na porta ${PORT}`);
});
