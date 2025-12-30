const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', activeUsers: waitingPool.size + Object.keys(pairedUsers).length });
});

// Store waiting users (users looking for a match)
const waitingPool = new Set();

// Store paired users: { socketId: partnerSocketId }
const pairedUsers = {};

// Helper function to pair two users
function pairUsers(socket1Id, socket2Id) {
  pairedUsers[socket1Id] = socket2Id;
  pairedUsers[socket2Id] = socket1Id;
  
  console.log(`Paired users: ${socket1Id} <-> ${socket2Id}`);
  
  // Notify both users that they've been paired
  // socket1Id is the initiator (the one who just searched), they will create the offer
  io.to(socket1Id).emit('paired', { peerId: socket2Id, initiator: true });
  io.to(socket2Id).emit('paired', { peerId: socket1Id, initiator: false });
}

// Helper function to unpair a user
function unpairUser(socketId) {
  const partnerId = pairedUsers[socketId];
  
  if (partnerId) {
    // Notify partner that the connection is ending
    io.to(partnerId).emit('peer-disconnected');
    
    // Remove both from paired users
    delete pairedUsers[socketId];
    delete pairedUsers[partnerId];
    
    console.log(`Unpaired: ${socketId} and ${partnerId}`);
    
    return partnerId;
  }
  
  return null;
}

// Helper function to find a match for a user
function findMatch(socketId) {
  // Remove user from waiting pool if they're in it
  waitingPool.delete(socketId);
  
  // If there's someone waiting, pair them
  if (waitingPool.size > 0) {
    const waitingUserId = waitingPool.values().next().value;
    waitingPool.delete(waitingUserId);
    pairUsers(socketId, waitingUserId);
    return true;
  } else {
    // Add to waiting pool
    waitingPool.add(socketId);
    console.log(`User ${socketId} added to waiting pool. Pool size: ${waitingPool.size}`);
    return false;
  }
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // User wants to find a peer
  socket.on('find-peer', () => {
    console.log(`${socket.id} is looking for a peer`);
    findMatch(socket.id);
  });
  
  // User wants to connect to next random person (swipe up)
  socket.on('next-peer', () => {
    console.log(`${socket.id} requested next peer`);
    
    // Unpair current connection
    const oldPartnerId = unpairUser(socket.id);
    
    // Find new match
    findMatch(socket.id);
    
    // If old partner exists, try to find them a new match too
    if (oldPartnerId) {
      findMatch(oldPartnerId);
    }
  });
  
  // WebRTC Signaling: Offer
  socket.on('offer', (data) => {
    const { offer, to } = data;
    console.log(`Forwarding offer from ${socket.id} to ${to}`);
    io.to(to).emit('offer', { offer, from: socket.id });
  });
  
  // WebRTC Signaling: Answer
  socket.on('answer', (data) => {
    const { answer, to } = data;
    console.log(`Forwarding answer from ${socket.id} to ${to}`);
    io.to(to).emit('answer', { answer, from: socket.id });
  });
  
  // WebRTC Signaling: ICE Candidate
  socket.on('ice-candidate', (data) => {
    const { candidate, to } = data;
    console.log(`Forwarding ICE candidate from ${socket.id} to ${to}`);
    io.to(to).emit('ice-candidate', { candidate, from: socket.id });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Remove from waiting pool
    waitingPool.delete(socket.id);
    
    // Unpair if in a call
    const partnerId = unpairUser(socket.id);
    
    // If partner exists, add them back to waiting pool
    if (partnerId) {
      findMatch(partnerId);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log(`\nFor mobile devices, use your computer's IP address:`);
  
  // Get local IP
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  http://${net.address}:${PORT}`);
      }
    }
  }
});

