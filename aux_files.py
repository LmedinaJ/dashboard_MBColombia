import pandas as pd

def main():

    # Leer el archivo de municipios para crear el mapeo
    territory_dict = {}
    with open("municipios.txt", "r") as f:
        for line in f:
            if ";" in line:
                code, name = line.strip().split(";")
                try:
                    territory_dict[float(code)] = name
                except ValueError:
                    continue

    # Leer el CSV
    df = pd.read_csv("AREAS-INTEGRACION-AMAZONIA-MUNICIPIO-DASH.csv")

    # Agregar columna con nombres desde municipios.txt
    df['territorio'] = df['territory'].astype(float)
    df['nombre_territorio'] = df['territorio'].map(territory_dict)
    
    # print(df.head())
    print(territory_dict)
    # Filtrar filas donde no se pudo mapear el territorio (valores NaN)
    df_valid = df.dropna(subset=['nombre_territorio']).copy()
    
    # Mostrar información sobre registros filtrados
    dropped_count = len(df) - len(df_valid)
    if dropped_count > 0:
        print(f"Advertencia: {dropped_count} registros eliminados por territorios no encontrados en municipios.txt")
        unmapped_territories = df[df['nombre_territorio'].isna()]['territory'].unique()
        print(f"Códigos de territorio no encontrados: {sorted(unmapped_territories)}")
    
    # Separar nombre_territorio en departamento y municipio
    nombre_split = df_valid['nombre_territorio'].str.split('-', expand=True)
    df_valid['departamento'] = nombre_split[0].str.strip()
    df_valid['municipio'] = nombre_split[1].str.strip()


    # Crear diccionario de departamentos únicos con IDs
    departamentos_unicos = sorted(df_valid['departamento'].unique())
    dept_ids = {dept: i+1 for i, dept in enumerate(departamentos_unicos)}
    
    # Guardar mapeo de IDs en departamentos.txt
    with open('departamentos.txt', 'w') as f:
        for dept, id_dept in dept_ids.items():
            f.write(f"{id_dept}.0;{dept}\n")
    
    # Agregar ID de departamento al DataFrame agrupado
    df_grouped = df_valid.groupby(['departamento', 'year', 'class'])['area'].sum().reset_index()
    df_grouped['dept_id'] = df_grouped['departamento'].map(dept_ids)
    
    # Crear DataFrame final con el formato requerido
    df_final = df_grouped.copy()
    df_final['territory'] = df_final['dept_id'].astype(float)
    
    # Seleccionar y ordenar columnas
    df_final = df_final[['territory', 'year', 'class', 'area']]
    
    # Agregar columnas system:index y .geo como en el archivo original
    df_final['system:index'] = df_final.apply(lambda x: f"0_{int(x['territory'])}", axis=1)
    df_final['.geo'] = '{"type":"MultiPoint","coordinates":[]}'
    
    # Ordenar columnas en el orden correcto
    df_final = df_final[['system:index', 'area', 'class', 'territory', 'year', '.geo']]
    
    # Ordenar por ID de departamento, año y clase
    df_final = df_final.sort_values(['territory', 'year', 'class'])
    
    # Guardar el resultado
    df_final.to_csv('AREAS-INTEGRACION-COLOMBIA-DPTOS-TEMP.csv', index=False)
    
    # Mostrar resultados
    print("\nArchivo departamentos.txt creado con el siguiente contenido:")
    with open('departamentos.txt', 'r') as f:
        print(f.read())
    
    print("\nPrimeras filas del archivo AREAS-INTEGRACION-COLOMBIA-DPTOS-TEMP.csv:")
    print(df_final.head(15))
    
    # Mostrar estadísticas
    print("\nResumen de datos:")
    print(f"Total de departamentos únicos: {len(departamentos_unicos)}")
    print(f"Años disponibles: {sorted(df_final['year'].unique())}")
    print(f"Clases disponibles: {sorted(df_final['class'].unique())}")
    print(f"Total de registros procesados: {len(df_valid)}")
    print(f"Total de registros finales: {len(df_final)}")

if __name__ == "__main__":
    main()