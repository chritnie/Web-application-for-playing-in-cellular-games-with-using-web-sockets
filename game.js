game = new Chess();
var socket = io();

var color = "white";
var players;
var roomId;
var play = true;

var room = document.getElementById("room");
var roomNumber = document.getElementById("roomNumbers");
var button = document.getElementById("button");
var state = document.getElementById('state');
var roomSockets = {};
  
var connect = function(){
    roomId = room.value;
    if (roomId !== "" && parseInt(roomId) <= 100) {
        room.remove();
        roomNumber.innerHTML = "Room Number " + roomId;
        button.remove();
        socket.emit('joined', roomId);
    }
}
var connectRating = function(){
    roomId = 100;
    if (roomId !== "" && parseInt(roomId) <= 100) {
        roomNumber.innerHTML = "Room Number " + roomId;
        button.remove();
        socket.emit('joined', roomId);
    }
}

socket.on('full', function (msg) {
    if(roomId === msg)
        window.location.assign(window.location.href+ 'full.html');
});

socket.on('startGame', function(data) {
    console.log(data);
    console.log(document);
    const playerInfo = document.getElementById('player');
    const opponentInfo = document.getElementById('opponent');
    
    playerInfo.innerHTML = `You: ${data.username} (rating: ${data.rating})`;
    opponentInfo.innerHTML = `Opponent: ${data.opponentUsername} (${data.opponentRating})`;
    state.innerHTML = "Game in progress";
});

socket.on('play', function (msg) {
    if (msg === roomId) {
        play = false;
        state.innerHTML = "Game in progress";
    }
});

socket.on('move', function (data) {
    game.move(data.move);
    board.position(game.fen()); // Update the board position
    var winner = game.turn() === 'b' ? playerNames['white'] : playerNames['black'];
    var loser = game.turn() === 'b' ? playerNames['black'] : playerNames['white'];
    if (game.game_over()) {
        state.innerHTML = 'GAME OVER';
        socket.emit('gameOver', {roomId: roomId, winner: winner, loser: loser});
    }
});
socket.on('gameOver', function(data) {
    var winner = game.turn() === 'b' ? playerNames['white'] : playerNames['black'];
    var loser = game.turn() === 'b' ? playerNames['black'] : playerNames['white'];
    state.innerHTML = `Game over, winner ${winner}`;
    const newRatingInfo = document.getElementById('newRating');
    newRatingInfo.innerHTML = `Your new rating: ${data.newRating}`;
});



var onDragStart = function (source, piece) {
    if (game.game_over() === true || play ||
        (game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1) ||
        (game.turn() === 'w' && color === 'black') ||
        (game.turn() === 'b' && color === 'white')) {
        return false;
    }
};

var onDrop = function (source, target) {
    var move = game.move({
        from: source,
        to: target,
        promotion: 'q' // NOTE: always promote to a queen for example simplicity
    });

    if (move === null) return 'snapback';
    else {
        socket.emit('move', { move: move, room: roomId, username: playerNames[color]});
        if (game.game_over()) {
            var winner = game.turn() === 'b' ? playerNames['white'] : playerNames['black'];
            var loser = game.turn() === 'b' ? playerNames['black'] : playerNames['white'];
            state.innerHTML = 'GAME OVER';
            socket.emit('gameOver', {roomId: roomId, winner: winner, loser: loser});
        }
    }
};

function startRatingMatch() {
    fetch('/start-rating-match', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include'
    })
    .then(response => response.json())
    .then(data => {
        if (data.matchFound) {
            window.location.href = `/game/${data.roomId}`;
        } else {
            alert('Searching for an opponent...');
        }
    })
    .catch(error => console.error('Error starting rating match:', error));
}



var onMouseoverSquare = function (square, piece) {
    var moves = game.moves({
        square: square,
        verbose: true
    });

    if (moves.length === 0) return;

    for (var i = 0; i < moves.length; i++) {
        greySquare(moves[i].to);
    }
};

var onMouseoutSquare = function (square, piece) {
    removeGreySquares();
};

var onSnapEnd = function () {
    board.position(game.fen());
};

var playerNames = {};

socket.on('player', (msg) => {
    console.log("Received player info:", msg);
    var plno = document.getElementById('player');
    color = msg.color;
    playerNames[color] = msg.playerId;
    plno.innerHTML = 'Player ' + msg.playerId + " (" + color + ")";
    players = msg.players;
    console.log(playerNames);
    if(players === 2){
        play = false;
        socket.emit('play', msg.roomId);
        state.innerHTML = "Game in Progress";
    }
    else
        state.innerHTML = "Waiting for Second player";

    var cfg = {
        orientation: color,
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onMouseoutSquare: onMouseoutSquare,
        onMouseoverSquare: onMouseoverSquare,
        onSnapEnd: onSnapEnd
    };
    board = ChessBoard('board', cfg);
});

var board;
