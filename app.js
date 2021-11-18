// Potential problems: multiple streamers, might send data from all streamers to all viewers
// Possible fix: tag viewer clients to unique streamerID, cycle through only that streamer when sending to all
// MatchID might work better

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { INIT_VOTE_HERO } = require('./helper')

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

// app.get('/status', (request, response) => response.write(JSON.stringify(viewerClients)));

const PORT = 3000;

let viewerClients = {};
// let viewerClients = [];
let gsiClients = [];
let voteHero = {}

var eventEmitter    = require('events').EventEmitter;
var events = new eventEmitter();

function gsi_client (ip, auth) {
    this.ip = ip;
    this.auth = auth;
    this.gamestate = {};
}
gsi_client.prototype.__proto__ = eventEmitter.prototype;

function Check_client(req, res, next) {
    // Check if this IP is already talking to us
    for (var i = 0; i < gsiClients.length; i++) {
        if (gsiClients[i].ip == req.ip) {
            req.client = gsiClients[i];
            return next();
        }
    }

    // Create a new client
    gsiClients.push(new gsi_client(req.ip, req.body.auth));
    req.client = gsiClients[gsiClients.length - 1];
    req.client.gamestate = req.body;

    // Notify about the new client
    events.emit('newclient', gsiClients[gsiClients.length - 1]);

    next();
}

function Emit_all(prefix, obj, emitter) {
    Object.keys(obj).forEach(function(key) {
        // For scanning keys and testing
        // emitter.emit("key", ""+prefix+key);
        // console.log("Emitting '"+prefix+key+"' - " + obj[key]);
        emitter.emit(prefix+key, obj[key]);
    });
}

function Recursive_emit(prefix, changed, body, emitter) {
    Object.keys(changed).forEach(function(key) {
        if (typeof(changed[key]) == 'object') {
            if (body[key] != null) { // safety check
                Recursive_emit(prefix+key+":", changed[key], body[key], emitter);
            }
        } else {
            // Got a key
            if (body[key] != null) {
                if (typeof body[key] == 'object') {
                    // Edge case on added:item/ability:x where added shows true at the top level
                    // and doesn't contain each of the child keys
                    Emit_all(prefix+key+":", body[key], emitter);
                } else {
                    // For scanning keys and testing
                    // emitter.emit("key", ""+prefix+key);
                    // console.log("Emitting '"+prefix+key+"' - " + body[key]);
                    emitter.emit(prefix+key, body[key]);
                }
            }
        }
    });
}

function Process_changes(section) {
    return function(req, res, next) {
        if (req.body[section]) {
            // console.log("Starting recursive emit for '" + section + "'");
            Recursive_emit("", req.body[section], req.body, req.client);
        }
        next();
    }
}

function Update_gamestate(req, res, next) {
    req.client.gamestate = req.body;
    next();
}

function New_data(req, res) {
    req.client.emit('newdata', req.body);
    res.end();
}

function Check_auth(tokens) {
    return function(req, res, next) {
        if (tokens) {
            if (req.body.auth && // Body has auth
                (req.body.auth.token == tokens || // tokens was a single string or
                (tokens.constructor === Array && // tokens was an array and
                tokens.indexOf(req.body.auth.token) != -1))) { // containing the token
                next();
            } else {
                // Not a valid auth, drop the message
                console.log("Dropping message from IP: " + req.ip + ", no valid auth token");
                res.end();
            }
        } else {
            next();
        }
    }
}

function sendEventsToAll(newEvent, streamerId) {
    console.log(streamerId)
    viewerClients[streamerId]?.forEach(client => client.response.write(`data: ${JSON.stringify(newEvent)}\n\n`))
    // viewerClients.forEach(client => client.response.write(`data: ${JSON.stringify(newEvent)}\n\n`))
}


app.post('/',
    // Check_auth(tokens),
    Check_client,
    Update_gamestate,
    Process_changes('previously'),
    Process_changes('added'),
    New_data);

app.listen(process.env.PORT || PORT, () => {
  console.log(`Facts Events service listening at https://twitch-dota-extension-backend.herokuapp.com/${PORT}`)
})

events.on('newclient', function(client) {
    console.log("New client connection, IP address: " + client.ip);
    // let clientSteamId32 = 0
    if (client.auth && client.auth.token) {
        console.log("Auth token: " + client.auth.token);
    } else {
    console.log("No Auth token");
    }

    // When player enters a game where steamid is accessible, start streamer log session
    if (client.gamestate.player.steamid){
        const clientSteamId = BigInt(client.gamestate.player.steamid)
        const clientSteamIdBin = (clientSteamId).toString(2)
        const clientSteamIdBinLast32 = clientSteamIdBin.slice(-32)
        const Y = BigInt(clientSteamIdBinLast32.slice(-1))
        const V = BigInt(76561197960265728) // Default identifier https://developer.valvesoftware.com/wiki/SteamID
        const Ztest = parseInt(clientSteamIdBinLast32.slice(0, 31), 2) // Account ID
        const clientSteamId32 = Ztest*2 + Number(Y) // Forumla from docs
        console.log(`New session for: ${clientSteamId32}`)
    }
    
    client.on('player:activity', function(activity) {
        if (activity == 'playing') console.log("Game started!");
    });
    client.on('hero:level', function(level) {
        console.log("Now level " + level);
        const eventInfo = {
            type: 'levelup',
            data: level,
            string: `Now level ${level}`
        }
        return sendEventsToAll(eventInfo, clientSteamId32);
    });
    client.on('player:kill_list:victimid_#', function(kill_list) {
        if (kill_list) console.log(kill_list);
        const eventInfo = {
            type: 'kill',
            data: kill_list,
            string: `Kill List ${kill_list}`
        }
        return sendEventsToAll(eventInfo, clientSteamId32);
    });
    client.on('hero:id', function(id){
        console.log("Picked " + id);
        const eventInfo = {
            type: 'pick',
            data: id,
            string: `Picked ${id}`
        }
        return sendEventsToAll(eventInfo, clientSteamId32);
    })
});


// ...

function eventsHandler(request, response, next) {
    const headers = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
    };
    response.writeHead(200, headers);
    const streamerId = request.params.streamerId
    console.log(streamerId)

    const data = `data: Waiting for event\n\n`;

    response.write(data);

    //   const clientId = Date.now();
    console.log(request.connection.remoteAddress)
    const clientId = request.ip

    const newClient = {
        id: clientId,
        response
    };

    if (viewerClients[streamerId]){
        viewerClients[streamerId].push(newClient);
    } else {
        viewerClients[streamerId] = [newClient];
    }

    console.log(viewerClients);
    request.on('close', () => {
    console.log(`${clientId} Connection closed`);
    viewerClients[streamerId] = viewerClients[streamerId]?.filter(client => client.id !== clientId);
    });
}

// Todo: Add streamerId here when connecting, chuck client under streamer's accountId
app.get('/events/:streamerId', eventsHandler);

// Todo: function for votes, sendToAll doesnt work
async function addVote(request, respsonse, next) {
    /*
    exampleBody = {
        heroId: 43
    }
    */
    const newVote = request.body;
    voteHero[newVote[streamerId]][newVote.heroId] += 1;
    respsonse.json(voteHero[newVote[streamerId]]);
    return sendEventsToAll(voteHero[newVote[streamerId]]);
}

async function initVote(request, respsonse, next) {
    /*
    exampleBody = {
        heroId: 43
    }
    */
    const streamerId = request.body;
    voteHero[streamerId] = INIT_VOTE_HERO;
    respsonse.json(voteHero[streamerId]);
    return sendEventsToAll(voteHero[streamerId]);
}

app.post('/viewer-vote-hero', addVote);

app.post('/init-vote-hero', initVote);