export function subscribeToConnectionStatus(socket, updateConnectionStatus) {
  const connected = () => updateConnectionStatus(true);
  const disconnected = () => updateConnectionStatus(false);

  updateConnectionStatus(Boolean(socket.connected));
  socket.on("connect", connected);
  socket.on("disconnect", disconnected);

  return () => {
    socket.off("connect", connected);
    socket.off("disconnect", disconnected);
  };
}
