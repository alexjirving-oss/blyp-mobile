import { io, Socket } from 'socket.io-client';

const SOCKET_SERVER_URL = 'http://your-socket-server-url'; // Replace with your socket server URL

class SocketService {
    private socket: Socket;

    constructor() {
        this.socket = io(SOCKET_SERVER_URL);
    }

    public connect() {
        this.socket.connect();
    }

    public disconnect() {
        this.socket.disconnect();
    }

    public onEvent(event: string, callback: (data: any) => void) {
        this.socket.on(event, callback);
    }

    public emitEvent(event: string, data: any) {
        this.socket.emit(event, data);
    }

    public getSocket() {
        return this.socket;
    }
}

const socketService = new SocketService();
export default socketService;