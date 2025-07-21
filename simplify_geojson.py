#!/usr/bin/env python3
"""
Script para simplificar geometrías GeoJSON y reducir tamaño de archivos
Autor: Dashboard Colombia - Amazon Integration  
"""

import json
import os
from pathlib import Path

def simplify_geojson(input_path, output_path, precision=4):
    """
    Simplifica un archivo GeoJSON reduciendo precisión de coordenadas
    
    Args:
        input_path: Ruta del archivo GeoJSON original
        output_path: Ruta para guardar archivo simplificado
        precision: Número de decimales para coordenadas (4 = ~11m precisión)
    """
    print(f"Simplificando: {os.path.basename(input_path)}")
    
    # Leer archivo original
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Función recursiva para simplificar coordenadas
    def simplify_coordinates(coords):
        if isinstance(coords[0], list):
            # Coordenadas anidadas (polígonos, etc.)
            return [simplify_coordinates(coord) for coord in coords]
        else:
            # Coordenadas simples [lon, lat]
            return [round(coord, precision) for coord in coords]
    
    # Procesar cada feature
    features_processed = 0
    for feature in data.get('features', []):
        if 'geometry' in feature and feature['geometry']:
            geometry = feature['geometry']
            if 'coordinates' in geometry:
                geometry['coordinates'] = simplify_coordinates(geometry['coordinates'])
                features_processed += 1
    
    # Guardar archivo simplificado
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))  # Sin espacios para menor tamaño
    
    # Estadísticas
    original_size = os.path.getsize(input_path) / (1024 * 1024)  # MB
    new_size = os.path.getsize(output_path) / (1024 * 1024)  # MB
    reduction = ((original_size - new_size) / original_size) * 100
    
    print(f"  ✅ {features_processed} features procesadas")
    print(f"  📉 Tamaño: {original_size:.1f}MB → {new_size:.1f}MB ({reduction:.1f}% reducción)")
    
    return {
        'file': os.path.basename(input_path),
        'original_size_mb': original_size,
        'new_size_mb': new_size,
        'reduction_percent': reduction,
        'features_processed': features_processed
    }

def main():
    """Función principal"""
    print("🗺️ Simplificador de GeoJSON")
    print("=" * 40)
    
    geojson_dir = "/Users/lujem/Documents/GAIA/dashboard_2025/docs/process/data/gis/geojson"
    output_dir = os.path.join(os.path.dirname(geojson_dir), "geojson_web")
    
    # Crear directorio de salida
    os.makedirs(output_dir, exist_ok=True)
    print(f"📁 Directorio salida: {output_dir}")
    print()
    
    # Encontrar archivos GeoJSON
    geojson_files = []
    for file in os.listdir(geojson_dir):
        if file.endswith('.geojson'):
            file_path = os.path.join(geojson_dir, file)
            file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
            geojson_files.append((file_path, file, file_size_mb))
    
    if not geojson_files:
        print("❌ No se encontraron archivos GeoJSON")
        return
    
    print("📊 Archivos encontrados:")
    for _, filename, size_mb in geojson_files:
        status = "🔴" if size_mb > 100 else "🟡" if size_mb > 50 else "🟢"
        print(f"  {status} {filename} ({size_mb:.1f}MB)")
    print()
    
    # Procesar cada archivo
    results = []
    for file_path, filename, size_mb in geojson_files:
        # Determinar precisión basada en tamaño
        if size_mb > 100:
            precision = 3  # Muy agresivo para archivos gigantes
        elif size_mb > 50:
            precision = 4  # Moderado para archivos grandes  
        else:
            precision = 5  # Conservador para archivos pequeños
            
        output_path = os.path.join(output_dir, filename)
        
        try:
            result = simplify_geojson(file_path, output_path, precision)
            result['precision'] = precision
            results.append(result)
        except Exception as e:
            print(f"  ❌ Error: {e}")
        
        print()
    
    # Resumen final
    print("📋 RESUMEN DE SIMPLIFICACIÓN")
    print("=" * 35)
    
    total_original = sum(r['original_size_mb'] for r in results)
    total_new = sum(r['new_size_mb'] for r in results)
    total_reduction = ((total_original - total_new) / total_original) * 100
    
    print(f"📊 Total: {total_original:.1f}MB → {total_new:.1f}MB ({total_reduction:.1f}% reducción)")
    print()
    
    for result in results:
        status = "✅" if result['new_size_mb'] < 50 else "⚠️" if result['new_size_mb'] < 100 else "❌"
        print(f"{status} {result['file']}: {result['new_size_mb']:.1f}MB ({result['reduction_percent']:.1f}% reducción)")
    
    print(f"\n📁 Archivos simplificados guardados en: /geojson_web/")
    print(f"🎯 Siguiente: Actualizar data_sources.json para usar /geojson_web/")

if __name__ == "__main__":
    main()