#!/usr/bin/env python3
"""
Script para convertir shapefiles a GeoJSON y organizar archivos
Autor: Dashboard Colombia - Amazon Integration
"""

import os
import glob
import shutil
import geopandas as gpd
from pathlib import Path
import json

def setup_directories(base_path):
    """Crear directorios para organizar archivos"""
    geojson_dir = os.path.join(base_path, "geojson")
    shapefiles_dir = os.path.join(base_path, "shapefiles")
    
    # Crear directorios si no existen
    os.makedirs(geojson_dir, exist_ok=True)
    os.makedirs(shapefiles_dir, exist_ok=True)
    
    return geojson_dir, shapefiles_dir

def find_shapefiles(gis_path):
    """Encontrar todos los archivos .shp en el directorio"""
    shapefiles = []
    
    # Buscar archivos .shp en el directorio principal
    shp_files = glob.glob(os.path.join(gis_path, "*.shp"))
    
    # También buscar en subdirectorios
    for root, dirs, files in os.walk(gis_path):
        for file in files:
            if file.endswith('.shp'):
                shp_path = os.path.join(root, file)
                if shp_path not in shp_files:
                    shp_files.append(shp_path)
    
    return shp_files

def convert_shapefile_to_geojson(shp_path, output_dir):
    """Convertir un shapefile a GeoJSON"""
    try:
        print(f"Convirtiendo: {os.path.basename(shp_path)}")
        
        # Leer el shapefile
        gdf = gpd.read_file(shp_path)
        
        # Asegurar que está en WGS84 (EPSG:4326) para web
        if gdf.crs != 'EPSG:4326':
            print(f"  Reproyectando de {gdf.crs} a EPSG:4326")
            gdf = gdf.to_crs('EPSG:4326')
        
        # Crear nombre del archivo GeoJSON
        base_name = os.path.splitext(os.path.basename(shp_path))[0]
        geojson_path = os.path.join(output_dir, f"{base_name}.geojson")
        
        # Convertir a GeoJSON
        gdf.to_file(geojson_path, driver='GeoJSON')
        
        # Obtener estadísticas
        feature_count = len(gdf)
        file_size_mb = os.path.getsize(geojson_path) / (1024 * 1024)
        
        print(f"  ✅ Convertido: {base_name}.geojson ({feature_count} features, {file_size_mb:.2f} MB)")
        
        return {
            'original': shp_path,
            'geojson': geojson_path,
            'base_name': base_name,
            'feature_count': feature_count,
            'size_mb': file_size_mb,
            'success': True
        }
        
    except Exception as e:
        print(f"  ❌ Error convirtiendo {os.path.basename(shp_path)}: {str(e)}")
        return {
            'original': shp_path,
            'base_name': os.path.splitext(os.path.basename(shp_path))[0],
            'error': str(e),
            'success': False
        }

def move_shapefile_components(shp_path, shapefiles_dir):
    """Mover todos los componentes de un shapefile a la carpeta shapefiles"""
    base_path = os.path.splitext(shp_path)[0]
    base_name = os.path.basename(base_path)
    
    # Extensiones comunes de shapefiles
    extensions = ['.shp', '.shx', '.dbf', '.prj', '.cpg', '.sbn', '.sbx', '.xml', '.qmd', '.fix']
    
    moved_files = []
    
    for ext in extensions:
        source_file = base_path + ext
        if os.path.exists(source_file):
            dest_file = os.path.join(shapefiles_dir, base_name + ext)
            try:
                shutil.move(source_file, dest_file)
                moved_files.append(dest_file)
            except Exception as e:
                print(f"  ⚠️ No se pudo mover {os.path.basename(source_file)}: {e}")
    
    return moved_files

def generate_conversion_report(results, output_dir):
    """Generar reporte de conversión"""
    report = {
        'conversion_summary': {
            'total_files': len(results),
            'successful': len([r for r in results if r['success']]),
            'failed': len([r for r in results if not r['success']]),
        },
        'converted_files': [],
        'failed_files': []
    }
    
    for result in results:
        if result['success']:
            report['converted_files'].append({
                'original_name': os.path.basename(result['original']),
                'geojson_name': f"{result['base_name']}.geojson",
                'feature_count': result['feature_count'],
                'size_mb': result['size_mb']
            })
        else:
            report['failed_files'].append({
                'original_name': os.path.basename(result['original']),
                'error': result['error']
            })
    
    # Guardar reporte
    report_path = os.path.join(output_dir, 'conversion_report.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    return report

def main():
    """Función principal"""
    print("🗺️ Conversor de Shapefiles a GeoJSON")
    print("=" * 50)
    
    # Rutas
    gis_path = "/Users/lujem/Documents/GAIA/dashboard_2025/docs/process/data/gis"
    
    # Verificar que el directorio existe
    if not os.path.exists(gis_path):
        print(f"❌ Error: No se encontró el directorio {gis_path}")
        return
    
    # Crear directorios de organización
    geojson_dir, shapefiles_dir = setup_directories(gis_path)
    print(f"📁 Carpeta GeoJSON: {geojson_dir}")
    print(f"📁 Carpeta Shapefiles: {shapefiles_dir}")
    print()
    
    # Encontrar todos los shapefiles
    shapefiles = find_shapefiles(gis_path)
    
    if not shapefiles:
        print("❌ No se encontraron archivos .shp")
        return
    
    print(f"📊 Encontrados {len(shapefiles)} shapefiles para convertir:")
    for shp in shapefiles:
        print(f"  • {os.path.basename(shp)}")
    print()
    
    # Convertir cada shapefile
    results = []
    
    for shp_path in shapefiles:
        # Convertir a GeoJSON
        result = convert_shapefile_to_geojson(shp_path, geojson_dir)
        results.append(result)
        
        # Si la conversión fue exitosa, mover archivos shapefile
        if result['success']:
            moved_files = move_shapefile_components(shp_path, shapefiles_dir)
            if moved_files:
                print(f"  📦 Movidos {len(moved_files)} archivos shapefile a /shapefiles/")
        
        print()  # Línea en blanco entre conversiones
    
    # Generar reporte
    report = generate_conversion_report(results, os.path.dirname(gis_path))
    
    print("📋 RESUMEN DE CONVERSIÓN")
    print("=" * 30)
    print(f"✅ Exitosos: {report['conversion_summary']['successful']}")
    print(f"❌ Fallidos: {report['conversion_summary']['failed']}")
    print(f"📊 Total: {report['conversion_summary']['total_files']}")
    
    if report['converted_files']:
        print("\n🎉 Archivos convertidos:")
        for file_info in report['converted_files']:
            print(f"  • {file_info['geojson_name']} ({file_info['feature_count']} features, {file_info['size_mb']:.1f}MB)")
    
    if report['failed_files']:
        print("\n⚠️ Archivos con errores:")
        for file_info in report['failed_files']:
            print(f"  • {file_info['original_name']}: {file_info['error']}")
    
    print(f"\n📄 Reporte guardado en: conversion_report.json")
    print(f"\n🎯 Siguiente paso: Actualizar data_sources.json para usar .geojson")

if __name__ == "__main__":
    # Verificar dependencias
    try:
        import geopandas as gpd
    except ImportError:
        print("❌ Error: geopandas no está instalado")
        print("Instala con: pip install geopandas")
        exit(1)
    
    main()