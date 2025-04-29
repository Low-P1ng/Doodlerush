/* global games, BONUS, round */
const leven = require('leven');
const GraphemeSplitter = require('grapheme-splitter');
const {
    get3Words,
    getScore,
    wait,
    getHints,
} = require('./helpers');

const splitter = new GraphemeSplitter();

class Game {
    constructor(io, socket) {
        this.io = io;
        this.socket = socket;
    }

    chosenWord(playerID) {
        const { io } = this;
        return new Promise((resolve, reject) => {
            function rejection(err) {
                reject(err);
            }
            const socket = io.of('/').sockets.get(playerID);
            if (!socket) return reject(new Error('Player socket not found'));
            socket.on('chooseWord', ({ word }) => {
                socket.to(socket.roomID).emit('hideWord',
                    { word: splitter.splitGraphemes(word).map((char) => (char !== ' ' ? '_' : char)).join('') }
                );
                socket.removeListener('disconnect', rejection);
                resolve(word);
            });
            socket.once('disconnect', rejection);
        });
    }

    resetGuessedFlag(players) {
        const { io } = this;
        players.forEach((playerID) => {
            const player = io.of('/').sockets.get(playerID);
            if (player) player.hasGuessed = false;
        });
    }

    async startGame() {
        const { io, socket } = this;
        const game = games[socket.roomID];
        if (!game) {
            console.error(`Game for room ${socket.roomID} not found`);
            return;
        }
        const { rounds } = game;
        const players = Array.from(await io.in(socket.roomID).allSockets());

        socket.to(socket.roomID).emit('startGame');

        for (let j = 0; j < rounds; j++) {
            for (let i = 0; i < players.length; i++) {
                await this.giveTurnTo(players, i);
            }
        }

        io.to(socket.roomID).emit('endGame', { stats: game });
        delete games[socket.roomID];
    }

    async giveTurnTo(players, i) {
        const { io, socket } = this;
        const { roomID } = socket;

        if (!games[roomID]) {
            console.error(`Room ${roomID} does not exist in games`);
            return;
        }

        const { time } = games[roomID];
        const player = players[i];
        const prevPlayer = players[(i - 1 + players.length) % players.length];
        const drawer = io.of('/').sockets.get(player);

        if (!drawer) {
            console.warn(`Drawer socket for player ${player} not found`);
            return;
        }

        this.resetGuessedFlag(players);
        games[roomID].totalGuesses = 0;
        games[roomID].currentWord = '';
        games[roomID].drawer = player;

        io.to(prevPlayer).emit('disableCanvas');
        drawer.to(roomID).broadcast.emit('choosing', { name: drawer.player?.name || 'Player' });
        io.to(player).emit('chooseWord', get3Words(roomID));

        try {
            const word = await this.chosenWord(player);
            games[roomID].currentWord = word;

            io.to(roomID).emit('clearCanvas');
            drawer.to(roomID).broadcast.emit('hints', getHints(word, roomID));

            games[roomID].startTime = Date.now() / 1000;
            io.to(roomID).emit('startTimer', { time });

            const drawerLeftEarly = await wait(roomID, drawer, time);
            if (drawerLeftEarly) {
                drawer.to(roomID).broadcast.emit('lastWord', { word });
            }
        } catch (error) {
            console.error('Error in giveTurnTo:', error.message);
        }
    }

    onMessage(data) {
        const { io, socket } = this;
        const room = games[socket.roomID];
        if (!room || !room.currentWord) return;

        const guess = data.message.toLowerCase().trim();
        if (guess === '') return;

        const currentWord = room.currentWord.toLowerCase();
        const distance = leven(guess, currentWord);

        if (distance === 0) {
            socket.emit('message', { ...data, name: socket.player.name });

            if (room.drawer !== socket.id && !socket.hasGuessed) {
                const drawer = io.of('/').sockets.get(room.drawer);
                if (!drawer) return;

                const { startTime, time: roundTime } = room;
                const roomSize = io.sockets.adapter.rooms.get(socket.roomID)?.size || 1;

                socket.emit('correctGuess', {
                    message: 'You guessed it right!',
                    id: socket.id
                });

                socket.broadcast.emit('correctGuess', {
                    message: `${socket.player.name} has guessed the word!`,
                    id: socket.id
                });

                room.totalGuesses++;
                room[socket.id].score += getScore(startTime, roundTime);
                room[drawer.id].score += BONUS;

                io.in(socket.roomID).emit('updateScore', {
                    playerID: socket.id,
                    score: room[socket.id].score,
                    drawerID: drawer.id,
                    drawerScore: room[drawer.id].score,
                });

                if (room.totalGuesses === roomSize - 1) {
                    round.emit('everybodyGuessed', { roomID: socket.roomID });
                }
            }

            socket.hasGuessed = true;
        } else if (distance < 3) {
            io.in(socket.roomID).emit('message', { ...data, name: socket.player.name });
            if (room.drawer !== socket.id && !socket.hasGuessed) {
                socket.emit('closeGuess', { message: 'That was very close!' });
            }
        } else {
            io.in(socket.roomID).emit('message', { ...data, name: socket.player.name });
        }
    }

    async getPlayers() {
        const { io, socket } = this;
        const players = Array.from(await io.in(socket.roomID).allSockets());

        io.in(socket.roomID).emit('getPlayers', players.map((id) => {
            const s = io.of('/').sockets.get(id);
            return s?.player || {};
        }));
    }
}

module.exports = Game;