#!/usr/bin/env python3
"""
Script to convert MASCARA CSV file from current format to expected dashboard format.

Current format: territory,name,class,year,area
Expected format: indice_sistema,area,cobertura,territorio,año,geo

Column mappings:
- territory → indice_sistema
- area → area
- class → cobertura
- name → territorio
- year → año
- Add empty geo column
"""

import pandas as pd
import os

def convert_mascara_csv():
    """Convert MASCARA CSV file to dashboard format."""
    
    # Input and output file paths
    input_file = "/Users/lujem/Documents/GAIA/dashboard_2025/AREAS-INTEGRACION-AMAZONIA-MASCARA-DASH_clases.csv"
    output_file = "/Users/lujem/Documents/GAIA/dashboard_2025/AREAS-INTEGRACION-AMAZONIA-MASCARA-DASH_clases_converted.csv"
    
    # Check if input file exists
    if not os.path.exists(input_file):
        print(f"Error: Input file not found: {input_file}")
        return False
    
    try:
        # Read the original CSV file
        print(f"Reading input file: {input_file}")
        df = pd.read_csv(input_file)
        
        # Display original structure
        print(f"Original file shape: {df.shape}")
        print("Original columns:", df.columns.tolist())
        print("\nFirst 5 rows of original data:")
        print(df.head())
        
        # Create new dataframe with mapped columns
        converted_df = pd.DataFrame({
            'indice_sistema': df['territory'],
            'area': df['area'],
            'cobertura': df['class'],
            'territorio': df['name'],
            'año': df['year'],
            'geo': ''  # Empty geo column as requested
        })
        
        # Display converted structure
        print(f"\nConverted file shape: {converted_df.shape}")
        print("Converted columns:", converted_df.columns.tolist())
        print("\nFirst 5 rows of converted data:")
        print(converted_df.head())
        
        # Save the converted file
        converted_df.to_csv(output_file, index=False)
        print(f"\nConverted file saved successfully: {output_file}")
        
        # Display summary statistics
        print("\nSummary statistics:")
        print(f"Total records: {len(converted_df)}")
        print(f"Unique territories: {converted_df['territorio'].nunique()}")
        print(f"Territory values: {converted_df['territorio'].unique()}")
        print(f"Year range: {converted_df['año'].min()} - {converted_df['año'].max()}")
        print(f"Unique coverage classes: {converted_df['cobertura'].nunique()}")
        print(f"Coverage values: {sorted(converted_df['cobertura'].unique())}")
        
        return True
        
    except Exception as e:
        print(f"Error during conversion: {str(e)}")
        return False

if __name__ == "__main__":
    success = convert_mascara_csv()
    if success:
        print("\nConversion completed successfully!")
    else:
        print("\nConversion failed!")