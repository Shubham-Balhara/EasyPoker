const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const IS_DEV = process.env.NODE_ENV !== 'production';

// ---- App & Socket Setup ----
const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);

// ---- In-Memory Data Structures ----
/**
 * rooms: {
 *   [roomName]: {
 *       name: string,
 *       ownerId: string,
 *       players: Array<Player>,
 *       turnIndex: number,
 *       centerPile: number[],
 *       stage: 'waiting' | 'playing' | 'tie_breaker' | 'finished',
 *       timer: NodeJS.Timeout | null,
 *       tieBreakerCard: number | null,
 *   }
 * }
 *
 * Player: {
 *   id: string, // socket.id
 *   name: string,
 *   deck: number[],
 * }
 */
const rooms = {};

// Utility to emit room state to all sockets inside the room
function broadcastRoomState(roomName) {
  const room = rooms[roomName];
  if (!room) return;
  const safeState = {
    name: room.name,
    ownerId: room.ownerId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, cards: p.deck.length })),
    turnIndex: room.turnIndex,
    centerTop: room.centerPile[room.centerPile.length - 1] || null,
    centerCount: room.centerPile.length,
    stage: room.stage,
    tieBreakerCard: room.tieBreakerCard,
  };
  io.to(roomName).emit('room_state', safeState);
}

function cardRank(index) {
  return index % 13; // 0-12, where 0 = Ace
}

// Convert rank to value where Ace high (14), 2 low (2)...
function rankValue(rank){
  return rank === 0 ? 14 : rank + 1; // 0 (Ace) -> 14, 1 ->2, ... 12->13
}

function generateCardIndex() {
  return Math.floor(Math.random() * 52); // 0-51 for 52-card deck
}

function generateDeck(baseCount = 20) {
  const variation = Math.floor(Math.random() * 11) - 3;
  const length = Math.max(1, baseCount + variation);
  const arr = [];
  for (let i = 0; i < length; i++) {
    arr.push(generateCardIndex());
  }
  return arr;
}

function nextPlayerIndex(room) {
  const total = room.players.length;
  if (total === 0) return 0;
  let idx = room.turnIndex;
  for (let i = 1; i <= total; i++) {
    const ni = (room.turnIndex + i) % total;
    if (room.players[ni].deck.length > 0) {
      idx = ni;
      break;
    }
  }
  return idx;
}

function startTurnTimer(roomName) {
  const room = rooms[roomName];
  if (!room) return;
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    const player = room.players[room.turnIndex];
    io.to(player.id).emit('turn_timeout');
    // Skip turn
    room.turnIndex = nextPlayerIndex(room);
    broadcastRoomState(roomName);
    startTurnTimer(roomName);
  }, 30_000);
}

function checkWinner(roomName) {
  const room = rooms[roomName];
  if (!room) return;
  const playersWithCards = room.players.filter((p) => p.deck.length > 0);
  if (playersWithCards.length === 1) {
    room.stage = 'finished';
    io.to(roomName).emit('game_over', { winnerId: playersWithCards[0].id, winnerName: playersWithCards[0].name });
    if (room.timer) clearTimeout(room.timer);
  }
}

function handleTieBreaker(roomName) {
  const room = rooms[roomName];
  if (!room) return;
  const playersActive = room.players.filter((p) => p.deck.length > 0);
  const playerEmpty = room.players.find((p) => p.deck.length === 0);
  if (playersActive.length !== 1 || !playerEmpty) return;
  const players = [playersActive[0], playerEmpty];
  // Shuffle center pile
  const shuffled = [...room.centerPile].sort(() => Math.random() - 0.5);
  let winner = null;
  for (let i = 0; i < shuffled.length; i++) {
    const currentPlayer = players[i % 2];
    const card = shuffled[i];
    if (card === room.tieBreakerCard) {
      winner = currentPlayer;
      break;
    }
  }
  if (!winner) winner = players[0]; // Fallback
  winner.deck.push(...room.centerPile);
  room.centerPile = [];
  room.tieBreakerCard = null;

  // Inform clients about tie-breaker winner
  io.to(roomName).emit('tiebreaker_result', { winnerId: winner.id, winnerName: winner.name });

  // Check if game has been won after receiving the center pile
  checkWinner(roomName);
  if (room.stage === 'finished') {
    // Game over emitted inside checkWinner, no further actions
    return;
  }

  // Otherwise continue game
  room.stage = 'playing';
  room.turnIndex = room.players.indexOf(winner);
  broadcastRoomState(roomName);
  sendTopCards(roomName);
  startTurnTimer(roomName);
}

// ---- Debug / Test Utilities ----
function debugAutoPlay(roomName, delay = 600) {
  const room = rooms[roomName];
  if (!room || room.stage !== 'playing') return;

  // Disable turn timer during autoplay
  if (room.timer) clearTimeout(room.timer);

  function playNext() {
    // Stop if game no longer in normal playing stage
    if (!rooms[roomName]) return;
    const r = rooms[roomName];
    if (r.stage !== 'playing') return;

    const player = r.players[r.turnIndex];

    // If player has no cards, advance turn and continue
    if (player.deck.length === 0) {
      r.turnIndex = nextPlayerIndex(r);
      setTimeout(playNext, delay);
      return;
    }

    const oldTop = r.centerPile[r.centerPile.length - 1];
    const card = player.deck.shift();
    r.centerPile.push(card);

    let isMatch = false;
    if (oldTop !== undefined && cardRank(card) === cardRank(oldTop)) {
      // player wins pile
      player.deck.push(...r.centerPile);
      r.centerPile = [];
      isMatch = true;
    }

    // elimination & tie-breaker check
    if (player.deck.length === 0) {
      const active = r.players.filter((p) => p.deck.length > 0);
      if (active.length === 1 && r.players.length > 1) {
        r.stage = 'tie_breaker';
        r.tieBreakerCard = card;
        broadcastRoomState(roomName);
        sendTopCards(roomName);
        setTimeout(() => handleTieBreaker(roomName), 500);
        return; // stop autoplay
      }
    }

    // Advance turn
    r.turnIndex = nextPlayerIndex(r);
    broadcastRoomState(roomName);
    sendTopCards(roomName);

    checkWinner(roomName);
    if (r.stage !== 'playing') return; // finished

    if (isMatch) {
      // stop autoplay on match
      startTurnTimer(roomName);
      return;
    }

    // schedule next turn
    setTimeout(playNext, delay);
  }

  playNext();
}

io.on('connection', (socket) => {
  socket.emit('config',{dev:IS_DEV});
  console.log('socket connected', socket.id);

  socket.on('create_room', ({ roomName, playerName }) => {
    if (rooms[roomName]) {
      socket.emit('error_msg', 'Room already exists');
      return;
    }
    socket.join(roomName);
    rooms[roomName] = {
      name: roomName,
      ownerId: socket.id,
      players: [
        {
          id: socket.id,
          name: playerName,
          deck: [],
        },
      ],
      turnIndex: 0,
      centerPile: [],
      stage: 'waiting',
      timer: null,
      tieBreakerCard: null,
    };
    broadcastRoomState(roomName);
  });

  socket.on('join_room', ({ roomName, playerName }) => {
    const room = rooms[roomName];
    if (!room) {
      socket.emit('error_msg', 'Room not found');
      return;
    }
    if (room.stage !== 'waiting') {
      socket.emit('error_msg', 'Game already started');
      return;
    }

    // Ensure unique player names within the room (case-insensitive)
    const nameTaken = room.players.some((p) => p.name.toLowerCase() === playerName.toLowerCase());
    if (nameTaken) {
      socket.emit('error_msg', 'Name already taken in this room. Please choose another name.');
      return;
    }
    socket.join(roomName);
    room.players.push({ id: socket.id, name: playerName, deck: [] });
    broadcastRoomState(roomName);
  });

  socket.on('start_game', ({ roomName, cardMultiplier }) => {
    const room = rooms[roomName];
    if (!room) return;
    if (socket.id !== room.ownerId) return;
    if (room.stage !== 'waiting') return;

    const base = Number(cardMultiplier) || 20;
    room.approxCards = base;
    room.players.forEach((p) => {
      p.deck = generateDeck(base);
    });
    room.centerPile = [];
    room.turnIndex = 0;
    room.stage = 'playing';
    broadcastRoomState(roomName);
    sendTopCards(roomName);
    startTurnTimer(roomName);
  });

  socket.on('play_card', ({ roomName }) => {
    const room = rooms[roomName];
    if (!room || room.stage !== 'playing') return;
    const currentPlayer = room.players[room.turnIndex];
    if (currentPlayer.id !== socket.id) return; // Not your turn
    if (currentPlayer.deck.length === 0) return;

    const oldTop = room.centerPile[room.centerPile.length - 1];
    const card = currentPlayer.deck.shift();
    room.centerPile.push(card);

    if (oldTop !== undefined && cardRank(card) === cardRank(oldTop)) {
      // Match in rank! current player wins pile
      currentPlayer.deck.push(...room.centerPile);
      room.centerPile = [];
    }

    // Check elimination & tie-breaker
    if (currentPlayer.deck.length === 0) {
      const activePlayers = room.players.filter((p) => p.deck.length > 0);
      if (activePlayers.length === 1 && room.players.length > 1) {
        // Tie-breaker scenario
        room.stage = 'tie_breaker';
        room.tieBreakerCard = card;
        if (room.timer) clearTimeout(room.timer);
        broadcastRoomState(roomName);
        //setTimeout(() => handleTieBreaker(roomName), 1_000); // 5s animation then result
        handleTieBreaker(roomName);
        return;
      }
    }

    // Advance turn
    room.turnIndex = nextPlayerIndex(room);
    broadcastRoomState(roomName);
    sendTopCards(roomName);

    checkWinner(roomName);
    if (room.stage === 'playing') startTurnTimer(roomName);
  });

  socket.on('debug_autoplay', ({ roomName }) => {
    const room = rooms[roomName];
    if (!room) return;
    if (socket.id !== room.ownerId) return; // only owner can trigger
    if (room.stage !== 'playing') return;
    debugAutoPlay(roomName);
  });

  socket.on('send_emoji', ({ roomName, emoji, playerName }) => {
    const room = rooms[roomName];
    if (!room) return;
    io.to(roomName).emit('emoji', { emoji, playerName });
  });

  // Owner can trigger sudden-death tie-breaker to conclude the game
  socket.on('force_tiebreaker', ({ roomName }) => {
    const room = rooms[roomName];
    if (!room) return;
    if (socket.id !== room.ownerId) return; // only owner
    if (room.stage !== 'playing') return; // only during playing stage

    // gather active players (with cards)
    const activePlayers = room.players.filter((p) => p.deck.length > 0);
    if (activePlayers.length === 0) return;

    // Build a list of [player, cardIdx] for every card still in play
    const allCards = [];
    activePlayers.forEach((player) => {
      player.deck.forEach((cardIdx) => {
        allCards.push({ player, cardIdx });
      });
    });

    if (allCards.length === 0) return;

    // Randomly pick one card to act as the sudden-death tie-breaker
    const chosen = allCards[Math.floor(Math.random() * allCards.length)];
    const tieBreakerCard = chosen.cardIdx;
    const potentialWinners = allCards
      .filter((c) => c.cardIdx === tieBreakerCard)
      .map((c) => c.player);

    // In the extremely rare case multiple players hold identical card indices, choose randomly among them
    const winner = potentialWinners[Math.floor(Math.random() * potentialWinners.length)];

    // Transition to tie_breaker stage to trigger shuffle animation on clients
    room.stage = 'tie_breaker';
    room.tieBreakerCard = tieBreakerCard;
    if (room.timer) clearTimeout(room.timer);
    broadcastRoomState(roomName);

    // Inform clients about the tiebreaker outcome (they’ll show winner modal after animation)
    io.to(roomName).emit('tiebreaker_result', { winnerId: winner.id, winnerName: winner.name });

    // Immediately finish the game (the client defers showing Game Over until after the tiebreaker modal closes)
    room.stage = 'finished';
    io.to(roomName).emit('game_over', { winnerId: winner.id, winnerName: winner.name });
  });

  socket.on('leave_room', ({roomName})=>{
    const room=rooms[roomName];
    if(!room) return;
    const idx=room.players.findIndex(p=>p.id===socket.id);
    if(idx===-1) return;
    const wasTurn=idx===room.turnIndex;
    room.players.splice(idx,1);
    socket.leave(roomName);
    if(room.players.length===0){
      delete rooms[roomName];
      return;
    }
    if(socket.id===room.ownerId){
      room.ownerId=room.players[0].id;
    }
    if(wasTurn){
      room.turnIndex=nextPlayerIndex(room);
    }
    broadcastRoomState(roomName);
    checkWinner(roomName);
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
    // Remove player from any room
    for (const roomName of Object.keys(rooms)) {
      const room = rooms[roomName];
      const idx = room.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
        const wasPlayerTurn = idx === room.turnIndex;
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          delete rooms[roomName];
          continue;
        }
        if (socket.id === room.ownerId) {
          room.ownerId = room.players[0].id; // Pass ownership
        }
        if (wasPlayerTurn) {
          room.turnIndex = nextPlayerIndex(room);
        }
        broadcastRoomState(roomName);
        checkWinner(roomName);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// Send each player their upcoming top card (face up only for themselves)
function sendTopCards(roomName) {
  const room = rooms[roomName];
  if (!room) return;
  room.players.forEach((p) => {
    const top = p.deck[0] !== undefined ? p.deck[0] : null;
    io.to(p.id).emit('your_top_card', top);
  });
} 