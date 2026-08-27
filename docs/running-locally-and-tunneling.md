# Run The Word Impostor on Your Laptop

This application is a JavaScript and JSX Node.js web application. The laptop hosting the game is the host device and keeps the room database, word packs, and live Socket.IO game state.

## Start the Game Server

1. Open `C:\Users\aksh0\Desktop\Word_hunt\Word_Imposter` in VS Code.
2. Open the integrated terminal in that folder.
3. Run `npm install` once to download dependencies.
4. Run `npm run dev` whenever you want to host a session.
5. Wait until the terminal confirms that the server is running on port `4300`.

The host opens `http://localhost:4300` on the laptop, enters `Host1234`, and creates a room code and room password. A non-host player enters their own User ID and then supplies that room code and password.

## Share a VS Code Tunnel with Phones

1. With `npm run dev` running, open the **Ports** panel in VS Code.
2. Select **Forward a Port** and enter `4300` if VS Code did not discover the port automatically.
3. Set the forwarded port visibility to the level appropriate for your group. Use the generated forwarding URL only with people you trust, because it exposes the live game on the internet.
4. Copy the forwarded URL and share it with friends. Each friend opens that same URL in their phone browser.
5. Keep the terminal, VS Code session, and laptop awake until the round ends. Closing the terminal or the tunnel disconnects all players.

> Do not share `http://localhost:4300` with phones. On a phone, `localhost` means that phone itself, not the host laptop. Share the VS Code forwarded URL instead.

## Local Network Alternative

If every phone and the laptop are on the same Wi-Fi network, use the laptop’s local IP address and port `4300`, for example `http://192.168.1.20:4300`. You may need to allow Node.js through Windows Firewall. The VS Code tunnel method is usually simpler when the local network blocks device-to-device connections.

## Important Session Notes

The local SQLite database is stored under `data/word-impostor.sqlite`, and uploaded custom word packs are stored under `data/word-packs/`. Keep the `data` folder if you want rooms and uploaded packs to remain available after restarting the server. A host can choose **Restart with new players** after a reveal to close the room and start a fresh session.
