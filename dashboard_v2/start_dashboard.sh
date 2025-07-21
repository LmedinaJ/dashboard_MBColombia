#!/bin/bash

echo "🌳 Iniciando Amazon Dashboard v2..."
echo "📁 Cambiando al directorio padre..."

# Change to parent directory 
cd "$(dirname "$0")/.."

echo "📂 Directorio actual: $(pwd)"
echo "🌐 Iniciando servidor HTTP en puerto 8080..."
echo "📊 Dashboard estará disponible en: http://localhost:8080/dashboard_v2/"
echo "⚡ Presiona Ctrl+C para detener el servidor"
echo "---------------------------------------------------"

# Start simple HTTP server
python3 -m http.server 8080