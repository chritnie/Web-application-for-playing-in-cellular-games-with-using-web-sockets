const express = require('express');
const http = require('http');
const socket = require('socket.io');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const User = require('./models/User.js');
const sessionStore = new session.MemoryStore();
const cookieParser = require('cookie-parser');
const sharedsession = require("express-socket.io-session");


const port = process.env.PORT || 8000;
var app = express();
const server = http.createServer(app);
const io = socket(server);
var roomSockets = {};
let matchmakingQueue = [];


mongoose.connect('mongodb://localhost:27017/chessdb')
    .then(() => console.log('MongoDB connected...'))
    .catch(err => console.log(err));


const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const sessionMiddleware = session({
    store: sessionStore,
    secret: 'chess_game_secret',
    resave: true,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        secure: false, 
        maxAge: 24 * 60 * 60 * 1000 
    }
});


app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

app.use(cookieParser('chess_game_secret'));

io.use(sharedsession(sessionMiddleware, {
    autoSave:true
}));
app.use(express.static(__dirname + "/"));
app.use(bodyParser.urlencoded({ extended: false }));
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

//const User = mongoose.model('User', UserSchema);

passport.use(new LocalStrategy(
    async function(username, password, done) {
        try {
            const user = await User.findOne({ username: username });
            if (!user) {
                return done(null, false, { message: 'Incorrect username.' });
            }
            if (!user.validPassword(password)) {
                return done(null, false, { message: 'Incorrect password.' });
            }
            return done(null, user);
        } catch (err) {
            return done(err);
        }
    }
));

const passportSocketIo = require("passport.socketio");
  
io.use(passportSocketIo.authorize({
    cookieParser: cookieParser,
    key: 'connect.sid',        
    secret: 'chess_game_secret',
    store: sessionStore,
    success: onAuthorizeSuccess,
    fail: onAuthorizeFail,
}));

passport.serializeUser(async (user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id).lean();
        if (user) {
            console.log('User deserialized', user.username);
            done(null, user);
        } else {
            done(new Error('User not found'), null);
        }
    } catch (err) {
        done(err, null);
    }
});



var games = Array(100).fill().map(() => ({ players: 0, pid: [0, 0] }));

app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

app.get('/register', (req, res) => {
    res.sendFile(__dirname + '/register.html');
});

app.get('/home', (req, res) => {
    res.sendFile(__dirname + '/home.html');
});

app.get('/lobby', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});


app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword, rating: 1200 });
        await newUser.save();
        console.log('New user registered with initial rating of 1200.');
        res.redirect('/login');
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).send('Error registering new user.');
    }
});

app.post('/login', passport.authenticate('local', {
    failureRedirect: '/login',
    failureFlash: false
}), function(req, res) {
    req.session.save(err => {
        if (err) {
            console.log('Session save error: ', err);
            return res.status(500).send('Error saving session');
        }
        res.redirect('/home');
    });
});


app.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        console.log('User is already authenticated, redirecting...');
        res.redirect('/home');
    } else {
        console.log('Serving login page');
        res.sendFile(__dirname + '/login.html');
    }
});

// Подготовка страницы игры для каждой комнаты
app.get('/game/:roomId', (req, res) => {
    const roomId = req.params.roomId;

    res.sendFile(__dirname + '/game_room.html', (err) => {
        if (err) {
            console.log('Error sending file:', err);
            res.status(500).send("An error occurred while trying to serve the game page.");
        }
    });
});




  function findOpponent(currentUser) {
    matchmakingQueue.sort((a, b) => Math.abs(a.rating - currentUser.rating) - Math.abs(b.rating - currentUser.rating));

    for (let i = 0; i < matchmakingQueue.length; i++) {
        if (Math.abs(matchmakingQueue[i].rating - currentUser.rating) <= 300) {
            return matchmakingQueue.splice(i, 1)[0];
        }
    }
    return null;
}


function createRoom(user1, user2) {
    const roomId = 'room_' + Date.now();
    roomSockets[roomId] = [user1, user2]; // Запомните пользователей в этой комнате
    return roomId;
}


io.on('connection', socket => {
    console.log('Socket connected:', socket.id);
    
    if (socket.request && socket.request.session && socket.request.session.passport && socket.request.session.passport.user) {
        console.log(`User ${socket.request.user.username} connected via socket with session ID ${socket.request.session.id}`);
    
        socket.on('findMatchByRating', () => {
            const currentUser = {
                username: socket.request.user.username,
                rating: socket.request.user.rating,
                id: socket.request.user._id
            };

            const opponent = findOpponent(currentUser);

            if (opponent) {
                const roomId = createRoom(currentUser, opponent);
                // Назначаем пользователям комнату и уведомляем их о начале игры
                [currentUser, opponent].forEach((user, index) => {
                    io.to(roomSockets[roomId][index].socketId).emit('matchFound', {
                        roomId,
                        opponentUsername: roomSockets[roomId][1-index].username,
                        opponentRating: roomSockets[roomId][1-index].rating
                    });
                });
            } else {
                matchmakingQueue.push(currentUser);
                socket.emit('matchWaiting');
            }
        });

        socket.on('joined', function (roomId) {
            if (!roomSockets[roomId]) {
                roomSockets[roomId] = [];
            }
            roomSockets[roomId].push({ socketId: socket.id, username: socket.request.user.username,  rating: socket.request.user.rating });
            
            if (roomSockets[roomId].length === 2) {
                roomSockets[roomId].forEach((playerSocket, index) => {
                    const opponent = roomSockets[roomId][1 - index]; // получаем оппонента
                    io.to(playerSocket.socketId).emit('startGame', {
                        username: playerSocket.username,
                        rating: playerSocket.rating,
                        opponentUsername: opponent.username,
                        opponentRating: opponent.rating
                    });
                });
                // Оба игрока подключены, начинаем игру
                io.to(roomSockets[roomId][0].socketId).emit('play', { room: roomId, players: roomSockets[roomId] });
                io.to(roomSockets[roomId][1].socketId).emit('play', { room: roomId, players: roomSockets[roomId] });
            }

            if (!socket.request.user.username) {
                console.log('Username not found in session');
                return;
            }
            if (games[roomId].players < 2) {
                games[roomId].players++;
                games[roomId].pid[games[roomId].players - 1] = socket.request.user.username;
            } else {
                socket.emit('full', roomId);
                return;
            }
            console.log(games[roomId]);
            var players = games[roomId].players;
            var color = players % 2 === 0 ? 'black' : 'white';
            socket.emit('player', { playerId: socket.request.user.username, players, color, roomId });
        });
        socket.on('gameOver', async function(data) {
            try {
                const winner = await User.findOneAndUpdate({ username: data.winner }, { $inc: { rating: 10 } }, { new: true });
                const loser = await User.findOneAndUpdate({ username: data.loser }, { $inc: { rating: -10 } }, { new: true });
                
                io.to(roomSockets[data.roomId][0].socketId).emit('updateRating', { newRating: winner.rating });
                io.to(roomSockets[data.roomId][1].socketId).emit('updateRating', { newRating: loser.rating });
        
                // Отправить всем в комнате инфо о победителе и обновленных рейтингах
                io.in(data.roomId).emit('gameFinished', { winner: data.winner, loser: data.loser, winnerRating: winner.rating, loserRating: loser.rating });
            } catch (error) {
                console.error('Error updating ratings:', error);
            }
        });

        socket.on('move', function (msg) {
            socket.broadcast.emit('move', msg);
        });
    
        socket.on('play', function (msg) {
            socket.broadcast.emit('play', msg);
            console.log("ready " + msg);
        });

        socket.on('disconnect', (reason) => {
            for (let i = 0; i < 100; i++) {
                if (games[i].pid[0] == socket.handshake.session.passport.user.username || games[i].pid[1] == socket.handshake.session.passport.user.username)
                    games[i].players--;
            }
            console.log('Socket disconnected:', socket.id, reason);
                console.log(socket.handshake.session.passport.user.username + ' disconnected');
        });
        
    } else {
        console.log('No user session found for socket connection');
        socket.emit('auth_error', 'No session found');
        socket.disconnect(true);
    }
});

app.post('/start-rating-match', (req, res) => {
    if (!req.isAuthenticated()) {
        console.log('User is not authenticated');
        return res.status(401).json({ error: "User is not authenticated" });
    }

    const currentUser = {
        id: req.user.id,
        username: req.user.username,
        rating: req.user.rating
    };

    const opponent = findOpponent(currentUser);
    

    if (opponent) {
        const roomId = createRoom(currentUser, opponent);
        res.json({ matchFound: true, roomId: roomId });
        io.to(roomSockets[roomId][0].socketId).emit('redirectToRoom', { roomId });
        io.to(roomSockets[roomId][1].socketId).emit('redirectToRoom', { roomId });
    } else {
        matchmakingQueue.push(currentUser);
        res.json({ matchFound: false });
    }
});


function updateRatings(winnerUsername, loserUsername) {
    const WIN_POINTS = 25;
    const LOSS_POINTS = -25;

    User.findOneAndUpdate({ username: winnerUsername }, { $inc: { rating: WIN_POINTS } }, { new: true })
        .then(updatedUser => console.log(`Updated winner's rating: ${updatedUser.rating}`))
        .catch(err => console.error(`Error updating winner's rating: ${err}`));

    User.findOneAndUpdate({ username: loserUsername }, { $inc: { rating: LOSS_POINTS } }, { new: true })
        .then(updatedUser => console.log(`Updated loser's rating: ${updatedUser.rating}`))
        .catch(err => console.error(`Error updating loser's rating: ${err}`));
}


function onAuthorizeSuccess(data, accept) {
    console.log('successful connection to socket.io with user:', data.user);
    accept(null, true);
}

function onAuthorizeFail(data, message, error, accept) {
    console.log('Failed connection to socket.io:', message);
    if (error) console.log('Error:', error);
    accept(null, false);
}

server.listen(port, () => {
    console.log('Server listening on port ' + port);
});