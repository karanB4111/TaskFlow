const { Server } = require("socket.io");
const logger = require("../utils/logger");

let io;

function initSocket(httpServer){
    io =  new Server(httpServer, {
        cors: {
            origin: "*",
        }
    });

    io.on("connection", (socket)=>{
        logger.info(`Socket connected: ${socket.id}`);


        // might need to add validation check for jobId, and also Auth 
        socket.on("subscribe", ({ jobId })=>{
            // Add validation logic here
            if (!jobId) {
                logger.error("Invalid jobId provided.");
                return;
            }

            const room = `job:${jobId}`;
            socket.join(room);
            logger.info(`Socket ${socket.id} subscribed to room ${room}`);
        })

        socket.on("disconnect", ()=>{
            logger.info(`Socket disconnected: ${socket.id}`);
        });
    });

    return io;
};

function getSocket(){
    if(!io){
        logger.error("Socket not initialized. Call initSocket first.");
        throw new Error("Socket not initialized. Call initSocket first.");
    }
    return io;
}

module.exports = {
    initSocket,
    getSocket
}