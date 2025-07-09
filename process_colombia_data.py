import pandas as pd

# Leer el archivo CSV
df = pd.read_csv('AREAS-INTEGRACION-COLOMBIA-MUNICIPIO.csv')

# Agrupar por departamento y año, sumar las áreas
df_grouped = df.groupby(['departamento', 'año'])['area'].sum().reset_index()

# Mantener solo departamentos con área > 0
df_filtered = df_grouped[df_grouped['area'] > 0]

# Guardar el resultado en un archivo temporal
df_filtered.to_csv('AREAS-INTEGRACION-COLOMBIA-DEPARTAMENTO.csv', index=False)