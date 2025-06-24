const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: '*' }
});
const PORT = process.env.PORT || 3001;

// Mapa maior
const MAP_WIDTH = 10000;
const MAP_HEIGHT = 10000;

let players = {};
let foods = [];

const INITIAL_FOOD_COUNT = 300; // Quantidade inicial de comida
const FOOD_SIZE = 5; // Raio da comida
const SNAKE_SEGMENT_SIZE = 10; // Raio de cada segmento da cobra
const SNAKE_SPEED = 5; // Velocidade da cobra
const TICK_RATE = 1000 / 30; // 30 atualiza��es por segundo (aproximadamente 33ms por tick)

function generateFood(count) {
    for (let i = 0; i < count; i++) {
        foods.push({
            id: Date.now() + Math.random(),
            x: Math.random() * MAP_WIDTH,
            y: Math.random() * MAP_HEIGHT,
            size: FOOD_SIZE // Adiciona tamanho para facilitar a renderiza��o e colis�o
        });
    }
}

generateFood(INITIAL_FOOD_COUNT);

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('start', (name) => {
        // Posi��o inicial aleat�ria para o jogador
        const startX = Math.random() * MAP_WIDTH;
        const startY = Math.random() * MAP_HEIGHT;

        players[socket.id] = {
            id: socket.id,
            name,
            x: startX, // Usado apenas para refer�ncia, a cobra usa snake[0].x
            y: startY, // Usado apenas para refer�ncia, a cobra usa snake[0].y
            direction: 'right', // Dire��o inicial
            snake: [{ x: startX, y: startY }], // A cabe�a da cobra
            score: 0, // Pontua��o inicial
            isAlive: true // Estado do jogador
        };
        socket.emit('init', { id: socket.id, players, foods, mapSize: { width: MAP_WIDTH, height: MAP_HEIGHT } });
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

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

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

// Loop principal do jogo no servidor
setInterval(() => {
    // Processa cada jogador
    for (const id in players) {
        const player = players[id];

        // Se o jogador n�o estiver vivo, n�o o processe no loop
        if (!player.isAlive) continue;

        // Cria uma c�pia da cabe�a atual da cobra
        const head = { ...player.snake[0] };

        // Atualiza a posi��o da cabe�a com base na dire��o
        if (player.direction === 'up') head.y -= SNAKE_SPEED;
        else if (player.direction === 'down') head.y += SNAKE_SPEED;
        else if (player.direction === 'left') head.x -= SNAKE_SPEED;
        else if (player.direction === 'right') head.x += SNAKE_SPEED;

        // Adiciona a nova cabe�a � cobra
        player.snake.unshift(head);

        let ateFood = false;
        // Verifica colis�es com comida
        for (let i = foods.length - 1; i >= 0; i--) { // Itera de tr�s para frente para remo��o segura
            const food = foods[i];
            // Dist�ncia da cabe�a da cobra at� a comida
            const dist = Math.hypot(head.x - food.x, head.y - food.y);
            if (dist < SNAKE_SEGMENT_SIZE + FOOD_SIZE) { // Colis�o se a dist�ncia for menor que a soma dos raios
                foods.splice(i, 1); // Remove a comida
                generateFood(1); // Gera nova comida
                ateFood = true;
                player.score += 1; // Aumenta a pontua��o
                // N�o remove a cauda, aumentando o tamanho da cobra
                break;
            }
        }

        if (!ateFood) {
            // Remove a cauda se n�o comeu comida (mant�m o mesmo tamanho)
            player.snake.pop();
        }

        // --- Verifica��es de Colis�o ---

        // 1. Colis�o com as paredes do mapa
        if (head.x < 0 || head.x > MAP_WIDTH || head.y < 0 || head.y > MAP_HEIGHT) {
            player.isAlive = false;
            io.to(player.id).emit('gameOver', 'Voc� colidiu com a parede!');
            console.log(`${player.name} colidiu com a parede.`);
        }

        // 2. Colis�o com o pr�prio corpo
        for (let i = 1; i < player.snake.length; i++) {
            const segment = player.snake[i];
            const dist = Math.hypot(head.x - segment.x, head.y - segment.y);
            if (dist < SNAKE_SEGMENT_SIZE) { // Se colidir com qualquer segmento do pr�prio corpo
                player.isAlive = false;
                io.to(player.id).emit('gameOver', 'Voc� colidiu com seu pr�prio corpo!');
                console.log(`${player.name} colidiu com o pr�prio corpo.`);
                break;
            }
        }

        // 3. Colis�o com outras cobras
        for (const otherId in players) {
            if (otherId === player.id || !players[otherId].isAlive) continue; // Ignora o pr�prio jogador e jogadores mortos

            const otherPlayer = players[otherId];
            const otherHead = otherPlayer.snake[0];

            // Colis�o da cabe�a do jogador atual com a cabe�a de outro jogador
            const distHeads = Math.hypot(head.x - otherHead.x, head.y - otherHead.y);
            if (distHeads < SNAKE_SEGMENT_SIZE * 2) { // Colis�o de cabe�a com cabe�a (considerando os dois raios)
                // L�gica de colis�o mais justa: o maior come o menor, ou ambos morrem se forem do mesmo tamanho.
                if (player.score > otherPlayer.score) {
                    // Jogador atual � maior, 'come' o outro jogador
                    otherPlayer.isAlive = false;
                    io.to(otherId).emit('gameOver', `Voc� foi comido por ${player.name}!`);
                    // Opcional: Aumentar o tamanho do jogador que comeu (com base no tamanho do outro)
                    // player.snake = player.snake.concat(otherPlayer.snake); // Isso pode ser muito grande, melhor s� adicionar alguns segmentos
                    player.score += Math.floor(otherPlayer.score / 2); // Ganha metade da pontua��o do outro
                    console.log(`${player.name} comeu ${otherPlayer.name}`);
                } else if (otherPlayer.score > player.score) {
                    // Outro jogador � maior, 'come' o jogador atual
                    player.isAlive = false;
                    io.to(player.id).emit('gameOver', `Voc� foi comido por ${otherPlayer.name}!`);
                    // otherPlayer.score += Math.floor(player.score / 2);
                    console.log(`${otherPlayer.name} comeu ${player.name}`);
                } else {
                    // Ambos t�m o mesmo tamanho ou colis�o m�tua, ambos morrem
                    player.isAlive = false;
                    otherPlayer.isAlive = false;
                    io.to(player.id).emit('gameOver', `Voc� colidiu com ${otherPlayer.name}!`);
                    io.to(otherId).emit('gameOver', `Voc� colidiu com ${player.name}!`);
                    console.log(`${player.name} e ${otherPlayer.name} colidiram.`);
                }
            }

            // Colis�o da cabe�a do jogador atual com o corpo de outro jogador
            for (let i = 1; i < otherPlayer.snake.length; i++) {
                const otherSegment = otherPlayer.snake[i];
                const distBody = Math.hypot(head.x - otherSegment.x, head.y - otherSegment.y);
                if (distBody < SNAKE_SEGMENT_SIZE) { // Colis�o com segmento do corpo
                    player.isAlive = false;
                    io.to(player.id).emit('gameOver', `Voc� colidiu com o corpo de ${otherPlayer.name}!`);
                    console.log(`${player.name} colidiu com o corpo de ${otherPlayer.name}.`);
                    break;
                }
            }
        }
    }

    // Filtra jogadores mortos antes de emitir o estado
    const alivePlayers = {};
    for (const id in players) {
        if (players[id].isAlive) {
            alivePlayers[id] = players[id];
        }
    }
    players = alivePlayers; // Atualiza a lista de jogadores

    // Envia o estado atualizado do jogo para todos os clientes
    io.emit('state', { players, foods });

    // Garante que haja comida suficiente no mapa
    if (foods.length < INITIAL_FOOD_COUNT) {
        generateFood(INITIAL_FOOD_COUNT - foods.length);
    }

}, TICK_RATE);


http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});