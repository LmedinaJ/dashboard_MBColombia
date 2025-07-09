import pandas as pd

# Read the original MASCARA CSV file
df = pd.read_csv('AREAS-INTEGRACION-AMAZONIA-MASCARA-DASH_clases.csv')

print("Original columns:", df.columns.tolist())
print("Original shape:", df.shape)
print("Sample data:")
print(df.head())

# Convert to expected format
# Current: territory,name,class,year,area
# Expected: indice_sistema,area,cobertura,territorio,año,geo

df_converted = pd.DataFrame({
    'indice_sistema': df['territory'],
    'area': df['area'],
    'cobertura': df['class'],
    'territorio': df['name'],  # This contains ANP, tis, translape
    'año': df['year'],
    'geo': ''  # Empty geo column for compatibility
})

print("\nConverted columns:", df_converted.columns.tolist())
print("Converted shape:", df_converted.shape)
print("Sample converted data:")
print(df_converted.head())

print("\nUnique categories in territorio:")
print(df_converted['territorio'].unique())

# Save the converted file
df_converted.to_csv('AREAS-INTEGRACION-AMAZONIA-MASCARA-DASH_clases_converted.csv', index=False)

print("\nFile saved as: AREAS-INTEGRACION-AMAZONIA-MASCARA-DASH_clases_converted.csv")