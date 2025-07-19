const socket = io();

const app = document.getElementById('app');

let currentRoom = null;
let currentPlayerId = null;
let roomState = null;

// Default approximate card multiplier, can be overwritten by owner
let cardMultiplier = 20;
let isDev = false;

// Animation helpers using deck-of-cards
let displayedCenterTop = null;
let displayedCenterCard = null;
let yourTopCard = null;
let displayedMyCard = null;
let tieAnimStarted = false;
let tieModalShowing = false;
let pendingGameOver = null;
// For cleanup between games
function resetGameState() {
  displayedCenterTop = null;
  if (displayedCenterCard) { displayedCenterCard.unmount(); displayedCenterCard = null; }
  yourTopCard = null;
  if (displayedMyCard) { displayedMyCard.unmount(); displayedMyCard = null; }
  tieAnimStarted = false;
  tieModalShowing = false;
  pendingGameOver = null;
  hideModal();
  clearTimeout(activeModalTimeout);
  const hb=document.getElementById('homeBtnTop');
  if(hb) hb.remove();
}

// Modal helpers
let activeModalTimeout = null;

function showModal(innerHTML, duration = null, onClose = null, disableClose = false) {
  clearTimeout(activeModalTimeout);
  let overlay = document.getElementById('modalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modalOverlay';
    overlay.innerHTML = '<div id="modalContent"></div>';
    document.body.appendChild(overlay);
  }
  const content = document.getElementById('modalContent');
  content.innerHTML = innerHTML;
  overlay.style.display = 'flex';

  // hide sudden death button while modal is open
  ensureSuddenDeathButton();

  function close() {
    overlay.style.display = 'none';
    overlay.removeEventListener('click', backdropClick);
    if (onClose) onClose();
  }

  function backdropClick(e) {
    if (!disableClose && e.target === overlay) {
      clearTimeout(activeModalTimeout);
      close();
    }
  }
  overlay.addEventListener('click', backdropClick);

  if (duration !== null) {
    activeModalTimeout = setTimeout(close, duration);
  }
}

function hideModal() {
  clearTimeout(activeModalTimeout);
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.style.display = 'none';
  // show / hide sudden death button after modal closes
  ensureSuddenDeathButton();
}

function startTieAnimation() {
  if (tieAnimStarted) return;
  tieAnimStarted = true;
  const container = document.getElementById('tieContainer');
  if (!container || !window.Deck) return;
  // create deck object and only show backs
  const deckObj = Deck();
  deckObj.cards.forEach((c) => {
    c.setSide('back');
  });
  deckObj.mount(container);
  deckObj.shuffle();
  deckObj.shuffle();
  deckObj.fan();
}

function syncCenterCard() {
  const container = document.getElementById('centerCardContainer');
  if (!container || !window.Deck) return;

  if (roomState && roomState.centerTop) {
    const containerChanged = displayedCenterCard && displayedCenterCard.$el && displayedCenterCard.$el.parentElement !== container;
    if (displayedCenterTop !== roomState.centerTop || containerChanged) {
      // remove old card
      if (displayedCenterCard) {
        displayedCenterCard.unmount();
        displayedCenterCard = null;
      }
      const cardObj = Deck.Card(roomState.centerTop);
      cardObj.mount(container);
      cardObj.setSide('front');
      cardObj.animateTo({ duration: 400, ease: 'quartOut', x: 0, y: 0, rot: 0 });
      displayedCenterCard = cardObj;
      displayedCenterTop = roomState.centerTop;
    }
  } else {
    if (displayedCenterCard) {
      displayedCenterCard.unmount();
      displayedCenterCard = null;
    }
    displayedCenterTop = null;
  }
}

function syncMyCard() {
  const container = document.getElementById('myTopCardContainer');
  if (!container || !window.Deck) return;
  if (yourTopCard !== null) {
    if (!displayedMyCard || displayedMyCard.i !== yourTopCard || (displayedMyCard.$el && displayedMyCard.$el.parentElement !== container)) {
      if (displayedMyCard) displayedMyCard.unmount();
      const cardObj = Deck.Card(yourTopCard);
      cardObj.mount(container);
      cardObj.setSide('front');
      cardObj.animateTo({ duration: 400, ease: 'quartOut', x: 0, y: 0, rot: 0 });
      displayedMyCard = cardObj;
    }
  } else {
    // Only remove card if deck is actually empty according to roomState
    const myIdx = roomState ? roomState.players.findIndex((p)=>p.id===currentPlayerId) : -1;
    const myDeckCount = myIdx >= 0 ? roomState.players[myIdx].cards : 0;
    if (myDeckCount === 0) {
      if (displayedMyCard) { displayedMyCard.unmount(); displayedMyCard = null; }
    }
  }
}

function render() {
  if (!roomState || roomState.stage === 'home') {
    renderHome();
  } else if (roomState.stage === 'waiting') {
    renderWaiting();
  } else if (roomState.stage === 'playing') {
    renderGame();
  } else if (roomState.stage === 'tie_breaker') {
    renderTieBreaker();
  } else if (roomState.stage === 'finished') {
    renderEnd();
  }

  // After DOM updated, sync animated center card
  syncCenterCard();
  syncMyCard();
  // reset tieAnimStarted when leaving tie breaker
  if (roomState && roomState.stage !== 'tie_breaker') {
    tieAnimStarted = false;
  }
  maybeHideModal();
  // update sudden death button visibility on every render cycle
  ensureSuddenDeathButton();
}

function renderHome() {
  resetGameState();
  app.innerHTML = `
    <div class="screen center">
      <h2>Easy Poker</h2>
      <input id="playerName" placeholder="Your Name" /> <br/>
      <input id="roomName" placeholder="Room Name" /> <br/>
      <button id="createBtn">Create Room</button>
      <button id="joinBtn">Join Room</button>
      <p id="error" style="color:red;"></p>
    </div>
  `;
  document.getElementById('createBtn').onclick = () => {
    const playerName = document.getElementById('playerName').value.trim();
    const roomName = document.getElementById('roomName').value.trim();
    if (!playerName || !roomName) return;
    socket.emit('create_room', { playerName, roomName });
  };
  document.getElementById('joinBtn').onclick = () => {
    const playerName = document.getElementById('playerName').value.trim();
    const roomName = document.getElementById('roomName').value.trim();
    if (!playerName || !roomName) return;
    socket.emit('join_room', { playerName, roomName });
  };
}

function renderWaiting() {
  const isOwner = roomState.ownerId === currentPlayerId;
  app.innerHTML = `
    <div class="banner-card title-card">Easy Poker</div>
    <div class="banner-card room-card">Room: ${roomState.name}</div>
    <div class="screen center">
      <p>Players In Room:</p>
      <ul class="waiting-list">
        ${roomState.players.map((p) => `<li>${p.name}${p.id === roomState.ownerId ? ' (Owner)' : ''}</li>`).join('')}
      </ul>
      ${isOwner ? '<input id="multInput" class="input-decor" type="number" min="5" max="50" value="20" /> Approx cards each<br/><button id="startBtn">Start Game</button>' : '<p style="font-size:18px;">Waiting for owner to start the game...</p>'}
    </div>
  `;
  if (isOwner) {
    document.getElementById('startBtn').onclick = () => {
      const val = parseInt(document.getElementById('multInput').value, 10);
      cardMultiplier = isNaN(val) ? 20 : val;
      socket.emit('start_game', { roomName: roomState.name, cardMultiplier });
    };
  }
  updatePlayerOverlayList();
}

function renderGame() {
  const myIndex = roomState.players.findIndex((p) => p.id === currentPlayerId);
  const me = roomState.players[myIndex];
  const isMyTurn = roomState.turnIndex === myIndex;
  app.innerHTML = `
    <div class="banner-card title-card">Easy Poker</div>
    <div class="banner-card room-card">Room: ${roomState.name}</div>
    <div class="screen center">
      <p>Center Pile: ${roomState.centerCount} cards</p>
      <div id="centerCardContainer"></div>
      <h4>Your Deck (${me.cards} cards)</h4>
      <div id="myTopCardContainer"></div>
      <p>${isMyTurn ? 'Your turn!' : 'Waiting for other players...'}</p>
      ${isMyTurn ? '<button id="playBtn">Play Card</button>' : ''}
      ${(isDev && currentPlayerId === roomState.ownerId) ? '<button id="autoBtn">Auto Play (test)</button>' : ''}
    </div>
  `;
  // after renderGame markup creation append emoji bar and player list overlay
  app.innerHTML += `
    <div id="emojiBar">
      <button class="emojiBtn">😀</button>
      <button class="emojiBtn">😂</button>
      <button class="emojiBtn">❤️</button>
      <button class="emojiBtn">👍</button>
      <button class="emojiBtn">👏</button>
      <button id="moreEmoji">➕</button>
    </div>
    <ul id="playerList"></ul>
  `;

  updatePlayerOverlayList();
  ensureHomeButton();

  // Emoji handlers
  document.querySelectorAll('.emojiBtn').forEach(btn=>{
    btn.onclick = ()=>{
      const emoji = btn.textContent;
      socket.emit('send_emoji',{ roomName: roomState.name, emoji, playerName: playerNameGlobal() });
    };
  });
  document.getElementById('moreEmoji').onclick=()=>{
    const emoji = prompt('Enter emoji');
    if (emoji) {
      socket.emit('send_emoji',{ roomName: roomState.name, emoji, playerName: playerNameGlobal() });
    }
  };

  if (isMyTurn) {
    document.getElementById('playBtn').onclick = () => {
      socket.emit('play_card', { roomName: roomState.name });
    };
  }
  if (currentPlayerId === roomState.ownerId) {
    const btn = document.getElementById('autoBtn');
    if (btn) btn.onclick = () => {
      socket.emit('debug_autoplay', { roomName: roomState.name });
    };
  }
}

function renderTieBreaker() {
  // underlying screen stays, but we overlay modal
  app.innerHTML = `
    <div class="screen center">
      <h3>Room: ${roomState.name}</h3>
      <p>Tie-Breaker in progress...</p>
    </div>
  `;

  const modalHTML = `
    <h3>Tie-Breaker Round!</h3>
    <div id="tieContainer" style="width:200px;height:300px;position:relative;margin:auto"></div>
    <p>Shuffling center pile...</p>
  `;
  showModal(modalHTML, null, null, true); // cannot be closed by click
  setTimeout(startTieAnimation, 100);
  ensureHomeButton();
}

function renderEnd() {
  const winner = roomState.players.find((p) => p.id === roomState.winnerId);
  app.innerHTML = `    <div class="screen center">
      <h2>Game Over</h2>
      <p>Winner: ${winner ? winner.name : 'Unknown'}</p>
      <button id="homeBtn">Back to Home</button>
    </div>
  `;
  document.getElementById('homeBtn').onclick = () => {
    resetGameState();
    roomState = { stage: 'home' };
    render();
  };
  ensureHomeButton();
}

// ---- Socket Events ----
socket.on('connect', () => {
  currentPlayerId = socket.id;
  roomState = { stage: 'home' };
  render();
});

socket.on('config', cfg=>{ isDev = cfg.dev; render(); });

socket.on('room_state', (state) => {
  roomState = { ...state };
  render();
  updatePlayerOverlayList();
});

socket.on('tiebreaker_result', ({ winnerName }) => {
  tieModalShowing = true;
  setTimeout(() =>
  showModal(`<h2>${winnerName} wins the tie-breaker!</h2>`, 3000, () => {
    tieModalShowing = false;
    if (pendingGameOver) {
      displayGameOver(pendingGameOver);
      pendingGameOver = null;
    }
  }), 4000);
});

socket.on('error_msg', (msg) => {
  alert(msg);
});

socket.on('turn_timeout', () => {
  showModal('<h3>Your turn was skipped due to timeout!</h3>', 5000);
});

socket.on('your_top_card', (cardIndex) => {
  yourTopCard = cardIndex;
  syncMyCard();
});

function displayGameOver({ winnerId, winnerName }) {
  roomState.stage = 'finished';
  roomState.winnerId = winnerId;
  render();
  showModal(`<div class="modal-card" style="transform:scale(0);transition:transform 0.6s ease-out;">🏆<br/>${winnerName}<br/>Wins!</div>`, 10000, () => {
    resetGameState();
    roomState = { stage: 'home' };
    render();
  });

  setTimeout(() => {
    const card = document.querySelector('.modal-card');
    if (card) card.style.transform = 'scale(1)';
  }, 50);
}

socket.on('game_over', ({ winnerId, winnerName }) => {
  if (tieModalShowing) {
    pendingGameOver = { winnerId, winnerName };
  } else {
    displayGameOver({ winnerId, winnerName });
  }
});

// Add helper
function showFloatingEmoji(emoji,name){
  const el=document.createElement('div');
  el.className='floating-emoji';
  el.textContent=emoji;
  // random horizontal offset
  const offset=(Math.random()*100)-50;
  el.style.left=`calc(50% + ${offset}px)`;
  if(name){
    const span=document.createElement('div');
    span.style.fontSize='14px';
    span.textContent=name;
    el.appendChild(span);
  }
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),4000);
}

// socket listener
socket.on('emoji',({emoji,playerName})=>{
  showFloatingEmoji(emoji,playerName);
});

// Ensure hideModal when leaving tie breaker or finished stages
function maybeHideModal() {
  if (roomState.stage !== 'tie_breaker' && roomState.stage !== 'finished') {
    hideModal();
  }
} 

// helper to get current player name
function playerNameGlobal(){
  const me=roomState?.players.find(p=>p.id===currentPlayerId);
  return me?me.name:'';
} 

// add helper after playerNameGlobal
function updatePlayerOverlayList(){
  const listEl=document.getElementById('playerList');
  if(!listEl||!roomState) return;
  const activeId = roomState.players[roomState.turnIndex]?.id;
  const others=roomState.players.filter(p=>p.id!==currentPlayerId);
  const items=others.map((p)=>`<li class="${p.id===activeId?'active':''}">${p.name} - ${p.cards}</li>`).join('');
  listEl.innerHTML=`<h4>Player List</h4>${items}`;
} 

// after updatePlayerOverlayList helper add createHomeButton
function ensureHomeButton(){
  if(!document.getElementById('homeBtnTop')){
    const btn=document.createElement('button');
    btn.id='homeBtnTop';
    btn.textContent='Home';
    btn.onclick=()=>{
       if(roomState && roomState.name){
         socket.emit('leave_room',{roomName:roomState.name});
       }
       resetGameState();
       roomState={stage:'home'};
       render();
    };
    document.body.appendChild(btn);
  }
} 

// Ensure sudden-death (owner tie-breaker) button
function ensureSuddenDeathButton(){
  let btn=document.getElementById('suddenDeathBtn');
  const overlay=document.getElementById('modalOverlay');
  const isModalOpen = overlay && overlay.style.display !== 'none' && overlay.style.display !== '';
  const shouldShow = roomState && roomState.stage==='playing' && roomState.ownerId===currentPlayerId && !isModalOpen;

  if(shouldShow){
    if(!btn){
      btn=document.createElement('button');
      btn.id='suddenDeathBtn';
      btn.textContent='Sudden Death';
      btn.style.position='fixed';
      btn.style.top='15px';
      btn.style.left='20px';
      btn.style.padding='8px 14px';
      btn.style.background='#f5a623';
      btn.style.color='#000';
      btn.style.border='none';
      btn.style.borderRadius='6px';
      btn.style.fontWeight='bold';
      btn.style.cursor='pointer';
      btn.style.zIndex='1600';
      btn.onclick=()=>{
        if(roomState && roomState.name){
          socket.emit('force_tiebreaker',{roomName:roomState.name});
        }
      };
      document.body.appendChild(btn);
    }
    btn.style.display='block';
  }else{
    if(btn) btn.style.display='none';
  }
} 
