import streamlit as st
import pandas as pd
import plotly.express as px
import json

st.set_page_config(
    page_title="Dashboard de Áreas de Integración Amazónica",
    page_icon="🌳",
    layout="wide",
    initial_sidebar_state="expanded"
)

@st.cache_data
def load_data_sources():
    """Load data sources configuration from JSON file"""
    try:
        with open("data_sources.json", "r", encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        st.error("No se encontró el archivo data_sources.json")
        return {}
    except json.JSONDecodeError as e:
        st.error(f"Error al parsear JSON: {e}")
        return {}
    except Exception as e:
        st.error(f"Error cargando fuentes de datos: {e}")
        return {}

@st.cache_data
def load_palette():
    """Load color palette for coverage classes"""
    palette_df = pd.read_csv("palette.txt", sep='\t', header=0)
    # Use ID and Color number columns
    palette_dict = {}
    for _, row in palette_df.iterrows():
        if pd.notna(row['ID']) and pd.notna(row['Color number']):
            palette_dict[row['ID']] = row['Color number']
    return palette_dict

@st.cache_data
def load_territory_names(codes_file, source_config):
    """Load territory names mapping from specified codes file"""
    territory_dict = {}
    try:
        with open(codes_file, "r") as f:
            for line in f:
                line = line.strip()
                if ";" in line:
                    parts = line.split(";")
                    if len(parts) == 2:
                        code_part = parts[0]
                        name_part = parts[1]
                        
                        # Handle dynamic columns if specified
                        if 'columns' in source_config and len(source_config['columns']) > 0:
                            if "-" in name_part:
                                # Split name_part by '-' and create descriptive name
                                name_components = name_part.split("-")
                                column_names = source_config['columns']
                                
                                # Create a descriptive name using column names
                                descriptive_parts = []
                                for i, component in enumerate(name_components):
                                    if i < len(column_names):
                                        descriptive_parts.append(f"{column_names[i]}: {component}")
                                    else:
                                        descriptive_parts.append(component)
                                name_part = " | ".join(descriptive_parts)
                        
                        # Try to convert code to float, fallback to string
                        try:
                            code = float(code_part)
                        except ValueError:
                            code = code_part
                        
                        territory_dict[code] = name_part
                        
                elif ":" in line:  # Fallback for old format
                    parts = line.split(": ")
                    if len(parts) == 2:
                        try:
                            code = float(parts[0])
                        except ValueError:
                            code = parts[0]
                        territory_dict[code] = parts[1]
    except Exception as e:
        st.error(f"Error loading territory names from {codes_file}: {e}")
    return territory_dict

@st.cache_data
def load_data(data_file, source_config):
    """Load and preprocess the Amazon integration data from specified file"""
    try:
        df = pd.read_csv(data_file)
        
        # Clean column names - base structure
        base_columns = ['indice_sistema', 'area', 'cobertura', 'territorio', 'año', 'geo']
        df.columns = base_columns[:len(df.columns)]
        
        # Process dynamic columns if specified
        if 'columns' in source_config and len(source_config['columns']) > 0:
            # Split the 'territorio' column using '-' separator
            territorio_parts = df['territorio'].astype(str).str.split('-', expand=True)
            
            # Create new columns based on the configuration
            for i, col_name in enumerate(source_config['columns']):
                if i < territorio_parts.shape[1]:
                    df[f'territorio_{col_name.lower()}'] = territorio_parts[i]
        
        # Convert data types
        df['area'] = pd.to_numeric(df['area'], errors='coerce')
        df['cobertura'] = pd.to_numeric(df['cobertura'], errors='coerce')
        
        # Handle territorio column - try to convert main territorio to numeric
        if 'territorio' in df.columns:
            df['territorio'] = pd.to_numeric(df['territorio'], errors='coerce')
        
        df['año'] = pd.to_numeric(df['año'], errors='coerce')
        
        # Remove rows with missing values in essential columns
        essential_cols = ['area', 'cobertura', 'año']
        if 'territorio' in df.columns:
            essential_cols.append('territorio')
        df = df.dropna(subset=essential_cols)
        
        return df
    except Exception as e:
        st.error(f"Error loading data from {data_file}: {e}")
        return pd.DataFrame()

def main():
    st.title("🌳 Dashboard de Áreas de Integración Amazónica")
    st.markdown("**Análisis de datos de integración de regiones amazónicas de 1985-2024**")
    
    # Load data sources configuration
    data_sources = load_data_sources()
    
    if not data_sources:
        st.error("No se pudieron cargar las fuentes de datos")
        return
    
    # Sidebar - Data source selector
    st.sidebar.header("📊 Fuente de Datos")
    
    # Add cache clear button
    if st.sidebar.button("🔄 Actualizar fuentes"):
        st.cache_data.clear()
        st.rerun()
    
    selected_source = st.sidebar.selectbox(
        "Seleccionar fuente de datos:",
        options=list(data_sources.keys()),
        index=0
    )
    
    # Get selected source configuration
    source_config = data_sources[selected_source]
    data_file = source_config['file']
    codes_file = source_config['codes']
    
    # Load data and palette
    with st.spinner(f"Cargando datos de {selected_source}..."):
        df = load_data(data_file, source_config)
        if df.empty:
            return
        color_palette = load_palette()
        territory_names = load_territory_names(codes_file, source_config)
    
    # Sidebar filters
    st.sidebar.header("Filtros")
    
    # Year filter
    year_range = st.sidebar.slider(
        "Seleccionar Rango de Años",
        min_value=int(df['año'].min()),
        max_value=int(df['año'].max()),
        value=(int(df['año'].min()), int(df['año'].max()))
    )
    
    # Dynamic territory filters based on columns configuration
    territory_filters = {}
    
    if 'columns' in source_config and len(source_config['columns']) > 0:
        # Multi-column territory filters
        for i, col_name in enumerate(source_config['columns']):
            col_key = f'territorio_{col_name.lower()}'
            if col_key in df.columns:
                unique_values = sorted(df[col_key].dropna().unique())
                
                with st.sidebar.expander(f"{col_name} ({len(unique_values)} disponibles)", expanded=False):
                    select_all_key = f"all_{col_name.lower()}"
                    select_all = st.checkbox(f"Seleccionar todos los {col_name.lower()}", value=True, key=select_all_key)
                    
                    if select_all:
                        territory_filters[col_key] = unique_values
                    else:
                        selected_values = st.multiselect(
                            f"Seleccionar {col_name.lower()} específicos:",
                            options=unique_values,
                            default=[],
                            key=f"filter_{col_name.lower()}"
                        )
                        territory_filters[col_key] = selected_values if selected_values else unique_values
    else:
        # Single territory filter (legacy)
        territories = sorted(df['territorio'].unique())
        territory_options = [f"{t} - {territory_names.get(t, 'Desconocido')}" for t in territories]
        
        with st.sidebar.expander(f"Territorios ({len(territories)} disponibles)", expanded=False):
            select_all_territories = st.checkbox("Seleccionar todos los territorios", value=True, key="all_territories")
            
            if select_all_territories:
                selected_territory_labels = territory_options
            else:
                selected_territory_labels = st.multiselect(
                    "Seleccionar territorios específicos:",
                    options=territory_options,
                    default=[]
                )
        
        # Extract territory codes from selected labels
        if not selected_territory_labels:
            selected_territories = territories
        else:
            selected_territories = [float(label.split(' - ')[0]) for label in selected_territory_labels]
    
    # Coverage filter with compact display
    coberturas = sorted(df['cobertura'].unique())
    cobertura_options = [str(int(c)) for c in coberturas]
    
    # Show selection count instead of all selected items
    with st.sidebar.expander(f"Coberturas ({len(coberturas)} disponibles)", expanded=False):
        select_all_coberturas = st.checkbox("Seleccionar todas las coberturas", value=True, key="all_coberturas")
        
        if select_all_coberturas:
            selected_cobertura_labels = cobertura_options
        else:
            selected_cobertura_labels = st.multiselect(
                "Seleccionar coberturas específicas:",
                options=cobertura_options,
                default=[]
            )
    
    # Extract coverage codes from selected labels
    if not selected_cobertura_labels:  # If nothing selected, show all
        selected_coberturas = coberturas
    else:
        selected_coberturas = [float(c) for c in selected_cobertura_labels]
    
    # Filter data - Handle both single and multi-column territories
    filter_conditions = [
        (df['año'] >= year_range[0]),
        (df['año'] <= year_range[1]),
        (df['cobertura'].isin(selected_coberturas))
    ]
    
    # Add territory filters
    if 'columns' in source_config and len(source_config['columns']) > 0:
        # Multi-column territory filtering
        for col_key, selected_values in territory_filters.items():
            if col_key in df.columns and selected_values:
                filter_conditions.append(df[col_key].isin(selected_values))
    else:
        # Single territory filtering (legacy)
        filter_conditions.append(df['territorio'].isin(selected_territories))
    
    # Apply all filters
    filtered_df = df
    for condition in filter_conditions:
        filtered_df = filtered_df[condition]
    
    # Main dashboard - Key metrics
    col1, col2, col3, col4, col5 = st.columns(5)
    
    # Calculate areas for specific classes
    area_clase_3 = filtered_df[filtered_df['cobertura'] == 3]['area'].sum()
    area_clase_15 = filtered_df[filtered_df['cobertura'] == 15]['area'].sum()
    area_clase_18 = filtered_df[filtered_df['cobertura'] == 18]['area'].sum()
    
    # Calculate totals for context
    total_area_clase_3 = df[df['cobertura'] == 3]['area'].sum()
    total_area_clase_15 = df[df['cobertura'] == 15]['area'].sum()
    total_area_clase_18 = df[df['cobertura'] == 18]['area'].sum()
    
    # Calculate percentages
    pct_clase_3 = (area_clase_3 / total_area_clase_3 * 100) if total_area_clase_3 > 0 else 0
    pct_clase_15 = (area_clase_15 / total_area_clase_15 * 100) if total_area_clase_15 > 0 else 0
    pct_clase_18 = (area_clase_18 / total_area_clase_18 * 100) if total_area_clase_18 > 0 else 0
    
    def format_area(area):
        """Format area with appropriate precision and line breaks for large numbers"""
        if area >= 1000000:  # 1 million or more
            return f"{area/1000000:.1f}M\nkm²"
        elif area >= 1000:   # 1 thousand or more
            return f"{area/1000:.1f}K\nkm²"
        elif area >= 1:      # 1 or more
            return f"{area:.1f}\nkm²"
        elif area >= 0.01:   # 0.01 or more
            return f"{area:.2f}\nkm²"
        else:                # Very small values
            return f"{area:.3f}\nkm²"
    
    def format_percentage(pct):
        """Format percentage with appropriate precision"""
        if pct >= 1:
            return f"{pct:.1f}% del total"
        elif pct >= 0.1:
            return f"{pct:.2f}% del total"
        else:
            return f"{pct:.3f}% del total"
    
    with col1:
        st.metric(
            "Área Bosque\n(Clase 3)", 
            format_area(area_clase_3),
            delta=format_percentage(pct_clase_3) if len(filtered_df) != len(df) else None
        )
    
    with col2:
        st.metric(
            "Área Agropecuaria\n(Clase 15)", 
            format_area(area_clase_15),
            delta=format_percentage(pct_clase_15) if len(filtered_df) != len(df) else None
        )
    
    with col3:
        st.metric(
            "Área Mosaico\n(Clase 18)", 
            format_area(area_clase_18),
            delta=format_percentage(pct_clase_18) if len(filtered_df) != len(df) else None
        )
    
    with col4:
        st.metric(
            "Regiones Seleccionadas", 
            f"{filtered_df['territorio'].nunique()} de {df['territorio'].nunique()}",
            delta=f"{(filtered_df['territorio'].nunique() / df['territorio'].nunique() * 100):.1f}% del total" if len(filtered_df) != len(df) else None
        )
    
    with col5:
        st.metric(
            "Coberturas Analizadas", 
            f"{filtered_df['cobertura'].nunique()} de {df['cobertura'].nunique()}",
            delta=f"{(filtered_df['cobertura'].nunique() / df['cobertura'].nunique() * 100):.1f}% del total" if len(filtered_df) != len(df) else None
        )
    
    # Coverage evolution over time - Move this right after metrics
    st.subheader("🌿 Evolución de Coberturas en el Tiempo")
    
    # Get top 10 coverages by total area
    top_coberturas = filtered_df.groupby('cobertura')['area'].sum().sort_values(ascending=False).head(10).index
    
    # Filter data for top coverages
    coverage_evolution = filtered_df[filtered_df['cobertura'].isin(top_coberturas)]
    coverage_yearly = coverage_evolution.groupby(['año', 'cobertura'])['area'].sum().reset_index()
    
    # Create color mapping for the line chart
    coverage_colors = {cobertura: color_palette.get(cobertura, '#808080') for cobertura in top_coberturas}
    
    fig_evolution = px.line(
        coverage_yearly,
        x='año',
        y='area',
        color='cobertura',
        title='Evolución de las Top 10 Coberturas por Área Total',
        labels={'area': 'Área Total (km²)', 'año': 'Año', 'cobertura': 'Cobertura'},
        color_discrete_map=coverage_colors
    )
    
    fig_evolution.update_layout(height=500)
    st.plotly_chart(fig_evolution, use_container_width=True)
    
    
    # Territory and Class Analysis
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("🗺️ Análisis de Territorios")
        
        # Dropdown to select which territorial column to analyze
        if 'columns' in source_config and len(source_config['columns']) > 0:
            # Multi-column options
            territory_column_options = {}
            for col_name in source_config['columns']:
                col_key = f'territorio_{col_name.lower()}'
                if col_key in filtered_df.columns:
                    territory_column_options[col_name] = col_key
            
            if territory_column_options:
                selected_territory_column_name = st.selectbox(
                    "Seleccionar nivel territorial para análisis:",
                    options=[name.title() for name in territory_column_options.keys()],
                    key="territory_analysis_column"
                )
                # Map back to original key for column lookup
                original_key = list(territory_column_options.keys())[
                    [name.title() for name in territory_column_options.keys()].index(selected_territory_column_name)
                ]
                selected_territory_column = territory_column_options[original_key]
                
                # Group by selected territorial column
                territory_summary = filtered_df.groupby(selected_territory_column)['area'].agg(['sum', 'mean', 'count']).reset_index()
                territory_summary = territory_summary.sort_values('sum', ascending=False)
                
                # Create display name
                territory_summary['territorio_display'] = territory_summary[selected_territory_column].astype(str)
                
                chart_title = f'Top 15 {selected_territory_column_name} por Área Total'
            else:
                st.warning("No hay columnas territoriales disponibles para análisis")
                territory_summary = pd.DataFrame()
        else:
            # Single territory column (legacy)
            territory_summary = filtered_df.groupby('territorio')['area'].agg(['sum', 'mean', 'count']).reset_index()
            territory_summary = territory_summary.sort_values('sum', ascending=False)
            
            # Add territory names
            territory_summary['nombre_territorio'] = territory_summary['territorio'].map(territory_names)
            territory_summary['territorio_display'] = territory_summary['territorio'].astype(str) + ' - ' + territory_summary['nombre_territorio'].fillna('Desconocido')
            
            chart_title = 'Top 15 Territorios por Área Total'
        
        if not territory_summary.empty:
            # Create dynamic title based on selected coverages
            if len(selected_coberturas) == len(coberturas):
                coverage_title = "Todas las Coberturas"
            elif len(selected_coberturas) == 1:
                coverage_title = f"Cobertura {int(selected_coberturas[0])}"
            else:
                coverage_title = f"{len(selected_coberturas)} Coberturas Seleccionadas"
            
            fig_territory = px.bar(
                territory_summary.head(15), 
                x='territorio_display', 
                y='sum', 
                title=f'{chart_title} ({coverage_title})',
                labels={'sum': 'Área Total (km²)', 'territorio_display': 'Territorio'},
                color_discrete_sequence=['#2E86AB']  # Blue color to avoid confusion with forest
            )
            fig_territory.update_layout(xaxis_tickangle=-45)
            st.plotly_chart(fig_territory, use_container_width=True)
    
    with col2:
        st.subheader("🏷️ Análisis de Coberturas")
        class_summary = filtered_df.groupby('cobertura')['area'].agg(['sum', 'mean', 'count']).reset_index()
        class_summary = class_summary.sort_values('sum', ascending=False)
        
        # Create custom color mapping for pie chart
        colors = [color_palette.get(cobertura, '#808080') for cobertura in class_summary['cobertura'].head(10)]
        
        fig_class = px.pie(
            class_summary.head(10), 
            values='sum', 
            names='cobertura', 
            title='Top 10 Coberturas por Área Total (km²)',
            color_discrete_sequence=colors
        )
        st.plotly_chart(fig_class, use_container_width=True)
    
    # Detailed data exploration
    st.subheader("📊 Exploración de Datos")
    
    st.write("**Muestra de Datos Crudos**")
    st.dataframe(filtered_df.head(1000))
    
    st.write("**Descargar Datos Filtrados**")
    csv = filtered_df.to_csv(index=False)
    st.download_button(
        label="Descargar datos como CSV",
        data=csv,
        file_name=f'datos_amazonia_filtrados_{year_range[0]}_{year_range[1]}.csv',
        mime='text/csv',
    )

if __name__ == "__main__":
    main()