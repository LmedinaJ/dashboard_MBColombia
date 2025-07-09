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
    names_dict = {}
    for _, row in palette_df.iterrows():
        if pd.notna(row['ID']) and pd.notna(row['Color number']):
            id_num = float(row['ID'])
            palette_dict[id_num] = row['Color number']
            if pd.notna(row['ESP']):
                # Remove number prefix (e.g., "1.1. ")
                name = row['ESP'].split('. ', 1)[1] if '. ' in row['ESP'] else row['ESP']
                names_dict[id_num] = name
    return palette_dict, names_dict

@st.cache_data
def load_territory_names(codes_file, source_config):
    """Load territory names mapping from specified codes file"""
    territory_dict = {}
    
    try:
        with open(codes_file, "r") as f:
            for line in f:
                line = line.strip()
                if ";" in line:
                    separator = ";"
                elif ":" in line:
                    separator = ":"
                else:
                    continue
                    
                parts = line.split(separator)
                if len(parts) != 2:
                    continue
                    
                code_part = parts[0].strip()
                name_part = parts[1].strip()
                
                try:
                    code = float(code_part)
                except ValueError:
                    continue
                
                territory_dict[code] = name_part
                
    except Exception as e:
        st.error(f"Error loading territory names from {codes_file}: {e}")
    
    
    return territory_dict

@st.cache_data
def load_data(data_file, source_config):
    """Load and preprocess the Amazon integration data from specified file"""
    try:
        df = pd.read_csv(data_file)
        
        # Special handling for MASCARA file format
        if 'MASCARA' in data_file or data_file.endswith('MASCARA-DASH_clases.csv'):
            # MASCARA has format: territory,name,class,year,area
            # Map to expected format: indice_sistema,area,cobertura,territorio,año,geo
            mascara_columns = ['territorio', 'name', 'cobertura', 'año', 'area']
            df.columns = mascara_columns[:len(df.columns)]
            
            # Reorder columns to match expected format - use 'name' for territorio, 'territorio' for indice_sistema
            df = df[['territorio', 'area', 'cobertura', 'name', 'año']]
            df.columns = ['indice_sistema', 'area', 'cobertura', 'territorio', 'año']
            
            # Standardize territory names
            df['territorio'] = df['territorio'].replace({
                'tis': 'TIS',
                'translape': 'Translape'
            })
            
            # Add geo column as empty for compatibility
            df['geo'] = ''
            
            # Process dynamic columns for MASCARA
            if 'columns' in source_config and len(source_config['columns']) > 0:
                for i, col_name in enumerate(source_config['columns']):
                    if col_name.lower() == 'categoria':
                        df[f'territorio_{col_name.lower()}'] = df['territorio']
        else:
            # Standard processing for other files
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
            # For MASCARA, don't convert territorio to numeric since it contains text (ANP, TIS, Translape)
            if 'MASCARA' not in data_file:
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
        color_palette, class_names = load_palette()
        territory_names = load_territory_names(codes_file, source_config)
    
    # Sidebar filters
    st.sidebar.header("Filtros")
    
    # Year filter
    min_year = int(df['año'].min())
    max_year = int(df['año'].max())
    if min_year == max_year:
        min_year = max_year - 1
    
    year_range = st.sidebar.slider(
        "Seleccionar Rango de Años",
        min_value=min_year,
        max_value=max_year,
        value=(min_year, max_year)
    )
    
    # Dynamic territory filters based on columns configuration
    territory_filters = {}
    
    if 'columns' in source_config and len(source_config['columns']) > 0:
        # Multi-column territory filters
        for col_name in source_config['columns']:
            col_key = f'territorio_{col_name.lower()}'
            if col_key in df.columns:
                # Get unique values
                unique_codes = sorted(df[col_key].dropna().unique())
                
                # Create display names and mappings
                display_names = []
                code_to_name = {}
                name_to_code = {}
                
                for code in unique_codes:
                    try:
                        # For MASCARA, codes are already text names (ANP, TIS, Translape)
                        if 'MASCARA' in data_file:
                            name = str(code)  # Use the code directly as it's already the name
                        else:
                            code_float = float(code)
                            name = territory_names.get(code_float, str(code))
                        display_names.append(name)
                        code_to_name[code] = name
                        name_to_code[name] = code
                    except:
                        # Fallback: use code as string if conversion fails
                        name = str(code)
                        display_names.append(name)
                        code_to_name[code] = name
                        name_to_code[name] = code
                
                with st.sidebar.expander(f"{col_name} ({len(display_names)} disponibles)", expanded=False):
                    select_all_key = f"all_{col_name.lower()}"
                    select_all = st.checkbox(f"Seleccionar todos los {col_name.lower()}", value=True, key=select_all_key)
                    
                    # Add search functionality with real-time updates
                    search_key = f"search_{col_name.lower()}"
                    
                    # Initialize session state for search
                    if search_key not in st.session_state:
                        st.session_state[search_key] = ""
                    
                    # Simple search with immediate filtering
                    search_term = st.text_input(
                        f"Buscar {col_name.lower()}:", 
                        key=search_key, 
                        placeholder="Escriba y presione Enter...",
                        help="Presione Enter o Tab para buscar"
                    )
                    
                    # Show real-time matches
                    if search_term:
                        matches = [name for name in display_names if search_term.lower() in name.lower()]
                        if matches:
                            st.success(f"💡 {len(matches)} coincidencia(s) encontrada(s)")
                            # Show first 3 matches as buttons for quick selection
                            st.write("**Resultados más relevantes:**")
                            cols = st.columns(min(3, len(matches)))
                            for i, match in enumerate(matches[:3]):
                                with cols[i]:
                                    if st.button(match, key=f"btn_{col_name}_{i}_{hash(match)}", use_container_width=True):
                                        # Auto-select this match
                                        st.session_state[f"selected_{col_name}"] = match
                                        st.rerun()
                            
                            if len(matches) > 3:
                                remaining = ", ".join(matches[3:8])
                                st.write(f"**Otras coincidencias:** {remaining}")
                                if len(matches) > 8:
                                    st.write(f"... y {len(matches) - 8} más")
                        else:
                            st.error("❌ No se encontraron coincidencias")
                        filtered_display_names = matches
                    else:
                        filtered_display_names = display_names
                    
                    if select_all:
                        # If search is active, filter the codes too
                        if search_term:
                            filtered_codes = [name_to_code[name] for name in filtered_display_names]
                            territory_filters[col_key] = filtered_codes
                        else:
                            territory_filters[col_key] = unique_codes
                    else:
                        selected_values = st.multiselect(
                            f"Seleccionar {col_name.lower()} específicos:",
                            options=filtered_display_names,
                            default=[],
                            key=f"filter_{col_name.lower()}"
                        )
                        
                        # Convert selected names back to codes
                        selected_codes = [name_to_code[val] for val in selected_values]
                        territory_filters[col_key] = selected_codes if selected_values else unique_codes
    else:
        # Single territory filter (legacy)
        territory_codes = sorted(df['territorio'].dropna().unique())
        territory_options = []
        code_to_name = {}
        name_to_code = {}
        
        for code in territory_codes:
            try:
                name = territory_names.get(float(code), str(code))
                territory_options.append(name)
                code_to_name[code] = name
                name_to_code[name] = code
            except:
                continue
        
        with st.sidebar.expander(f"Territorios ({len(territory_options)} disponibles)", expanded=False):
            select_all_territories = st.checkbox("Seleccionar todos los territorios", value=True, key="all_territories")
            
            # Add search functionality with real-time updates
            if "search_territory" not in st.session_state:
                st.session_state["search_territory"] = ""
            
            # Simple search with immediate filtering
            search_territory = st.text_input(
                "Buscar territorios:", 
                key="search_territory", 
                placeholder="Escriba y presione Enter...",
                help="Presione Enter o Tab para buscar"
            )
            
            # Show real-time matches
            if search_territory:
                matches = [name for name in territory_options if search_territory.lower() in name.lower()]
                if matches:
                    st.success(f"💡 {len(matches)} coincidencia(s) encontrada(s)")
                    # Show first 3 matches as buttons for quick selection
                    st.write("**Resultados más relevantes:**")
                    cols = st.columns(min(3, len(matches)))
                    for i, match in enumerate(matches[:3]):
                        with cols[i]:
                            if st.button(match, key=f"btn_territory_{i}_{hash(match)}", use_container_width=True):
                                # Auto-select this match
                                st.session_state["selected_territory"] = match
                                st.rerun()
                    
                    if len(matches) > 3:
                        remaining = ", ".join(matches[3:8])
                        st.write(f"**Otras coincidencias:** {remaining}")
                        if len(matches) > 8:
                            st.write(f"... y {len(matches) - 8} más")
                else:
                    st.error("❌ No se encontraron coincidencias")
                filtered_territory_options = matches
            else:
                filtered_territory_options = territory_options
            
            if select_all_territories:
                # If search is active, filter the codes too
                if search_territory:
                    filtered_codes = [name_to_code[name] for name in filtered_territory_options]
                    selected_territories = filtered_codes
                else:
                    selected_territories = territory_codes
            else:
                selected_values = st.multiselect(
                    "Seleccionar territorios específicos:",
                    options=filtered_territory_options,
                    default=[],
                    key="territory_filter"
                )
                selected_territories = [name_to_code[val] for val in selected_values] if selected_values else territory_codes
    
    # Coverage filter with compact display
    coberturas = sorted(df['cobertura'].unique())
    cobertura_options = [str(int(c)) for c in coberturas]
    
    # Show selection count instead of all selected items
    with st.sidebar.expander(f"Coberturas ({len(coberturas)} disponibles)", expanded=False):
        select_all_coberturas = st.checkbox("Seleccionar todas las coberturas", value=True, key="all_coberturas")
        
        # Add search functionality with real-time updates
        if "search_cobertura" not in st.session_state:
            st.session_state["search_cobertura"] = ""
        
        # Simple search with immediate filtering
        search_cobertura = st.text_input(
            "Buscar coberturas:", 
            key="search_cobertura", 
            placeholder="Escriba y presione Enter...",
            help="Presione Enter o Tab para buscar"
        )
        
        # Show real-time matches
        if search_cobertura:
            matches = [option for option in cobertura_options if search_cobertura.lower() in option.lower()]
            if matches:
                st.success(f"💡 {len(matches)} coincidencia(s) encontrada(s)")
                # Show first 3 matches as buttons for quick selection
                st.write("**Resultados más relevantes:**")
                cols = st.columns(min(3, len(matches)))
                for i, match in enumerate(matches[:3]):
                    with cols[i]:
                        if st.button(match, key=f"btn_cobertura_{i}_{hash(match)}", use_container_width=True):
                            # Auto-select this match
                            st.session_state["selected_cobertura"] = match
                            st.rerun()
                
                if len(matches) > 3:
                    remaining = ", ".join(matches[3:8])
                    st.write(f"**Otras coincidencias:** {remaining}")
                    if len(matches) > 8:
                        st.write(f"... y {len(matches) - 8} más")
            else:
                st.error("❌ No se encontraron coincidencias")
            filtered_cobertura_options = matches
        else:
            filtered_cobertura_options = cobertura_options
        
        if select_all_coberturas:
            # If search is active, filter the labels too
            if search_cobertura:
                selected_cobertura_labels = filtered_cobertura_options
            else:
                selected_cobertura_labels = cobertura_options
        else:
            selected_cobertura_labels = st.multiselect(
                "Seleccionar coberturas específicas:",
                options=filtered_cobertura_options,
                default=[],
                key="coverage_filter"
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
    # Get initial and final years from filtered data
    initial_year = int(filtered_df['año'].min())
    final_year = int(filtered_df['año'].max())
    
    # Calculate areas for specific classes by year
    def get_area_by_year_class(year, class_id):
        year_data = filtered_df[filtered_df['año'] == year]
        return year_data[year_data['cobertura'] == class_id]['area'].sum()
    
    # Areas for initial year
    area_clase_3_initial = get_area_by_year_class(initial_year, 3)
    area_clase_15_initial = get_area_by_year_class(initial_year, 15)
    area_clase_18_initial = get_area_by_year_class(initial_year, 18)
    
    # Areas for final year
    area_clase_3_final = get_area_by_year_class(final_year, 3)
    area_clase_15_final = get_area_by_year_class(final_year, 15)
    area_clase_18_final = get_area_by_year_class(final_year, 18)
    
    # Calculate changes
    cambio_clase_3 = area_clase_3_final - area_clase_3_initial
    cambio_clase_15 = area_clase_15_final - area_clase_15_initial
    cambio_clase_18 = area_clase_18_final - area_clase_18_initial
    
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
    
    
    # Create two sections for better visualization
    st.subheader(f"📊 Comparación {initial_year} vs {final_year}")
    
    # First row - Initial year
    st.write(f"**Año {initial_year}**")
    col1_init, col2_init, col3_init = st.columns(3)
    
    with col1_init:
        st.metric(
            f"Área {class_names.get(3, 'Formación forestal')}\n(Clase 3)", 
            format_area(area_clase_3_initial)
        )
    
    with col2_init:
        st.metric(
            f"Área {class_names.get(15, 'Pastos')}\n(Clase 15)", 
            format_area(area_clase_15_initial)
        )
    
    with col3_init:
        st.metric(
            f"Área {class_names.get(18, 'Agricultura')}\n(Clase 18)", 
            format_area(area_clase_18_initial)
        )
    
    # Second row - Final year with changes
    st.write(f"**Año {final_year}**")
    col1_final, col2_final, col3_final = st.columns(3)
    
    with col1_final:
        st.metric(
            f"Área {class_names.get(3, 'Formación forestal')}\n(Clase 3)", 
            format_area(area_clase_3_final),
            delta=format_area(cambio_clase_3)
        )
    
    with col2_final:
        st.metric(
            f"Área {class_names.get(15, 'Pastos')}\n(Clase 15)", 
            format_area(area_clase_15_final),
            delta=format_area(cambio_clase_15)
        )
    
    with col3_final:
        st.metric(
            f"Área {class_names.get(18, 'Agricultura')}\n(Clase 18)", 
            format_area(area_clase_18_final),
            delta=format_area(cambio_clase_18)
        )
    
    # Additional metrics
    st.write("**Resumen de Filtros**")
    col4, col5 = st.columns(2)
    
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
            # Comment out the territorial level selector for now
            # selected_territory_column_name = st.selectbox(
            #     "Seleccionar nivel territorial para análisis:",
            #     options=[name.title() for name in territory_column_options.keys()],
            #     key="territory_analysis_column"
            # )
            # # Map back to original key for column lookup
            # original_key = list(territory_column_options.keys())[
            #     [name.title() for name in territory_column_options.keys()].index(selected_territory_column_name)
            # ]
            # selected_territory_column = territory_column_options[original_key]
            
            # Use the first available column as default
            selected_territory_column_name = list(territory_column_options.keys())[0].title()
            selected_territory_column = territory_column_options[list(territory_column_options.keys())[0]]
            
            # Group by selected territorial column
            territory_summary = filtered_df.groupby(selected_territory_column)['area'].agg(['sum', 'mean', 'count']).reset_index()
            territory_summary = territory_summary.sort_values('sum', ascending=False)
            
            # Create display name using territory names with line breaks for long names
            def format_territory_name(code):
                # For MASCARA, codes are already text (ANP, tis, translape), not numeric
                if 'MASCARA' in data_file:
                    name = str(code)  # Use the code directly as it's already the name
                else:
                    name = territory_names.get(float(code), str(code))
                # Replace 'Resguardo' with 'R.' for TIS territories
                name = name.replace('Resguardo', 'R.')
                if len(name) > 20:  # If name is too long, split it
                    words = name.split()
                    mid = len(words) // 2
                    return '<br>'.join([' '.join(words[:mid]), ' '.join(words[mid:])])
                return name
            
            # For MASCARA, don't convert to float since territories are text
            if 'MASCARA' in data_file:
                territory_summary['territorio_display'] = territory_summary[selected_territory_column].apply(format_territory_name)
            else:
                territory_summary['territorio_display'] = territory_summary[selected_territory_column].astype(float).apply(format_territory_name)
            
            chart_title = f'Top 15 {selected_territory_column_name} por Área Total'
        else:
            st.warning("No hay columnas territoriales disponibles para análisis")
            territory_summary = pd.DataFrame()
    else:
        # Single territory column (legacy)
        territory_summary = filtered_df.groupby('territorio')['area'].agg(['sum', 'mean', 'count']).reset_index()
        territory_summary = territory_summary.sort_values('sum', ascending=False)
        
        # Add territory names using the mapping with line breaks for long names
        def format_territory_name(code):
            # For MASCARA, codes are already text (ANP, tis, translape), not numeric
            if 'MASCARA' in data_file:
                name = str(code)  # Use the code directly as it's already the name
            else:
                name = territory_names.get(float(code), str(code))
            # Replace 'Resguardo' with 'R.' for TIS territories
            name = name.replace('Resguardo', 'R.')
            if len(name) > 20:  # If name is too long, split it
                words = name.split()
                mid = len(words) // 2
                return '<br>'.join([' '.join(words[:mid]), ' '.join(words[mid:])])
            return name
        
        territory_summary['territorio_display'] = territory_summary['territorio'].apply(format_territory_name)
        
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
        fig_territory.update_layout(
            xaxis_tickangle=-45,  # Rotate labels for better readability
            xaxis_title="Territorio",
            yaxis_title="Área Total (km²)",
            height=600,  # Increase height to accommodate two-line labels
            margin=dict(b=120)  # Increase bottom margin for labels
        )
        st.plotly_chart(fig_territory, use_container_width=True)
    
    st.subheader("🏷️ Análisis de Coberturas")
    class_summary = filtered_df.groupby('cobertura')['area'].agg(['sum', 'mean', 'count']).reset_index()
    class_summary = class_summary.sort_values('sum', ascending=False)
    
    # Add coverage names
    class_summary['nombre_cobertura'] = class_summary['cobertura'].map(class_names)
    
    # Create custom color mapping for pie chart
    colors = [color_palette.get(cobertura, '#808080') for cobertura in class_summary['cobertura'].head(10)]
    
    fig_class = px.pie(
        class_summary.head(10), 
        values='sum', 
        names='nombre_cobertura', 
        title='Top 10 Coberturas por Área Total (km²)',
        color_discrete_sequence=colors,
        hole=0.4  # Create donut chart with 40% hole
    )
    
    fig_class.update_layout(
        height=500,
        showlegend=True,
        legend=dict(
            orientation="v",
            yanchor="middle",
            y=0.5,
            xanchor="left",
            x=1.05
        ),
        title=dict(
            y=0.95,  # Move title higher to increase space
            x=0.5,
            xanchor='center',
            yanchor='top'
        ),
        margin=dict(t=80)  # Increase top margin for more space between title and chart
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