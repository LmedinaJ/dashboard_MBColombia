// Dashboard Application
class AmazonDashboard {
    constructor() {
        this.data = [];
        this.filteredData = [];
        this.currentDataSource = '';
        this.dataSources = {};
        this.territoryNames = {};
        this.coverageNames = {};
        this.spatialTabularMappings = {}; // Advanced spatial-tabular integration (by data source)
        this.charts = {};
        this.popupCharts = new Map(); // Store popup chart instances for cleanup
        this.geojsonInfo = null; // Store info about loaded GeoJSON
        
        // Configuration parameters
        this.config = {
            tableMaxHeight: 200, // 🔧 CONFIGURABLE: Max height in pixels for table scroll (also change in CSS)
            enableMapBounds: false, // 🔧 CONFIGURABLE: Whether to restrict map panning to loaded GIS layer bounds
            tableMaxRows: 10, // 🔧 CONFIGURABLE: Maximum number of rows to display in data exploration table
            territoryChartMaxItems: 15 // 🔧 CONFIGURABLE: Maximum number of territories to show in bar chart
        };
        this.map = null;
        this.mapLayer = null;
        this.currentMapData = null;
        this.filters = {
            yearMin: 1985,
            yearMax: 2024,
            territories: new Set(),
            coverages: new Set(),
            searchTerms: {
                territory: '',
                coverage: ''
            }
        };

        this.init();
    }

    async init() {
        this.showLoading(true);
        await this.loadDataSources();
        this.setupEventListeners();
        this.setupCharts();
        this.setupMap();
        
        // Load first data source by default
        const firstSource = Object.keys(this.dataSources)[0];
        if (firstSource) {
            await this.loadDataSource(firstSource);
        }
        
        this.showLoading(false);
    }

    async loadDataSources() {
        try {
            const response = await fetch('./data_sources.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.dataSources = await response.json();
            this.populateDataSourceSelect();
        } catch (error) {
            this.showError('Error cargando fuentes de datos: ' + error.message);
        }
    }

    populateDataSourceSelect() {
        const select = document.getElementById('dataSource');
        if (!select) return;
        
        select.innerHTML = '';
        
        const keys = Object.keys(this.dataSources);
        keys.forEach((key, index) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = this.dataSources[key].description;
            
            // Seleccionar automáticamente la primera opción
            if (index === 0) {
                option.selected = true;
                // Cargar automáticamente la primera fuente de datos
                setTimeout(() => this.loadDataSource(key), 100);
            }
            
            select.appendChild(option);
        });
    }

    async loadDataSource(sourceName) {
        if (!sourceName) return;
        
        this.showLoading(true);
        this.currentDataSource = sourceName;
        
        try {
            // Load the CSV file from the new data directory
            const fileName = this.dataSources[sourceName].file;
            const dataPath = `./process/data/${fileName}`;
            
            const response = await fetch(dataPath);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const csvText = await response.text();
            
            if (csvText.length > 50000000) { // 50MB limit  
                throw new Error(`CSV file too large (${Math.round(csvText.length/1000000)}MB). Maximum supported size is 50MB.`);
            }
            
            if (csvText.length > 20000000) { // Warn for files > 20MB
            }
            
            try {
                this.data = this.parseCSV(csvText);
            } catch (csvError) {
                if (csvError.message.includes('Maximum call stack size exceeded')) {
                    throw new Error('CSV file too complex to parse - likely due to file size or format issues');
                }
                throw csvError;
            }
            
            // Filter out territories that have 0 area for all years
            try {
                this.data = this.filterValidTerritories(this.data);
            } catch (filterError) {
                if (filterError.message.includes('Maximum call stack size exceeded')) {
                    throw new Error('Data filtering too complex - dataset too large for territory validation');
                }
                throw filterError;
            }
            
            // Load territory and coverage names if available
            await this.loadMappings(this.dataSources[sourceName]);
            
            // Load spatial-tabular mappings for advanced integration
            await this.loadSpatialTabularMappings(this.dataSources[sourceName]);
            
            try {
                this.updateFilters();
                this.updateTableYearFilter(); // Update table year filter after data is loaded
                this.applyFilters();
                this.updateCharts();
                this.updateTable();
                this.updateMetrics();
                this.updateMapControls();
            } catch (uiError) {
                if (uiError.message.includes('Maximum call stack size exceeded')) {
                    throw new Error('Interface update too complex - dataset too large for visualization');
                }
                throw uiError;
            }
            
            // Populate debug table
            
            // Auto-load corresponding GIS layer
            this.loadCorrespondingGisLayer();
            
        } catch (error) {
            if (error.message.includes('Maximum call stack size exceeded')) {
                this.showError(`Error: Los datos de ${sourceName} son demasiado complejos para procesar. Intenta con un archivo más pequeño o simplificado.`);
            } else {
                this.showError(`Error cargando datos: ${error.message}`);
            }
        }
        
        this.showLoading(false);
    }

    parseCSV(csvText) {
        const lines = csvText.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const result = [];
        
        // Process in chunks to avoid stack overflow for large files
        const chunkSize = 1000;
        const totalLines = lines.length - 1;
        
        for (let i = 1; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize);
            
            for (const line of chunk) {
                if (!line.trim()) continue; // Skip empty lines
                
                const values = line.split(',');
                const row = {};
                
                headers.forEach((header, index) => {
                    let value = values[index]?.trim() || '';
                    
                    // Try to convert numeric values (but keep territory as string for matching)
                    if (header === 'area' || header === 'class' || header === 'year') {
                        const numValue = parseFloat(value);
                        if (!isNaN(numValue)) {
                            value = numValue;
                        }
                    }
                    
                    row[header] = value;
                });
                
                result.push(row);
            }
            
            // Progress feedback for large files
            if (totalLines > 50000 && i % 10000 === 0) {
                // Optional: could show progress in UI instead of console
            }
        }
        
        return result;
    }

    filterValidTerritories(data) {
        // Calculate total area per territory across all years
        const territoryTotals = {};
        
        data.forEach(row => {
            const territory = row.territory;
            const area = parseFloat(row.area) || 0;
            
            if (!territoryTotals[territory]) {
                territoryTotals[territory] = 0;
            }
            territoryTotals[territory] += area;
        });
        
        // Get list of territories with total area > 0
        const validTerritories = new Set();
        Object.entries(territoryTotals).forEach(([territory, totalArea]) => {
            if (totalArea > 0) {
                validTerritories.add(territory);
            }
        });
        
        // Filter data to include only valid territories
        const filteredData = data.filter(row => validTerritories.has(row.territory));
        
        return filteredData;
    }

    hasValidDataForFeature(feature) {
        // Get the id_area from GeoJSON properties
        const idArea = feature.properties.id_area;
        if (!idArea) {
            return false;
        }
        
        // Convert GeoJSON id_area to CSV territory using codes mapping
        const csvTerritory = this.convertIdAreaToTerritory(idArea);
        if (!csvTerritory) {
            return false;
        }
        
        // Check if this territory exists in our filtered data (territories with area > 0)
        const hasData = this.data.some(row => {
            const territoryId = row.territory ? row.territory.toString() : '';
            return territoryId === csvTerritory.toString();
        });
        
        return hasData;
    }

    async loadMappings(sourceConfig) {
        // Load territory names mapping
        if (sourceConfig.codes) {
            try {
                const codesPath = `./process/codigos/${sourceConfig.codes}`;
                const response = await fetch(codesPath);
                const text = await response.text();
                this.territoryNames = this.parseMappingFile(text);
            } catch (error) {
                // Could not load territory mapping
            }
        }

        // Load coverage names (palette)
        try {
            const response = await fetch('./process/codigos/palette.txt');
            const text = await response.text();
            this.coverageNames = this.parsePalette(text);
        } catch (error) {
            // Could not load coverage names
        }
    }

    async loadSpatialTabularMappings(sourceConfig) {
        // Only load if we have codes file and columns configuration
        
        if (!sourceConfig.codes || !sourceConfig.columns) {
            return;
        }
        
        try {
            const codesPath = `./process/codigos/${sourceConfig.codes}`;
            const response = await fetch(codesPath);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const text = await response.text();
            
            // Parse the structured data and store by data source
            const mappingsForThisSource = this.parseSpatialTabularData(text, sourceConfig.columns);
            
            // Store mappings by data source to avoid conflicts
            if (!this.spatialTabularMappings[this.currentDataSource]) {
                this.spatialTabularMappings[this.currentDataSource] = {};
            }
            this.spatialTabularMappings[this.currentDataSource] = mappingsForThisSource;
            
        } catch (error) {
            // Initialize empty mappings for this source
            if (!this.spatialTabularMappings[this.currentDataSource]) {
                this.spatialTabularMappings[this.currentDataSource] = {};
            }
        }
    }

    parseSpatialTabularData(text, columns) {
        const mappings = {};
        const lines = text.split('\n').filter(line => line.trim());
        
        let skipped = 0;
        let parsed = 0;
        
        lines.forEach((line, index) => {
            try {
                // Parse format: "id_gee;id_area;data1;data2;..." (using id_gee as key)
                const dataValues = line.split(';');
                
                if (dataValues.length < columns.length) {
                    skipped++;
                    return;
                }
                
                // Create object mapping columns to values
                const mappedData = {};
                columns.forEach((columnName, columnIndex) => {
                    mappedData[columnName] = (dataValues[columnIndex] || '').trim();
                });
                
                // Use the first column (id_gee) as the key for mapping
                const idGee = dataValues[0].trim();
                if (idGee) {
                    mappings[idGee] = mappedData;
                    parsed++;
                }
                
            } catch (error) {
                // Error parsing line
            }
        });
        
        return mappings;
    }

    parseMappingFile(text) {
        const mapping = {};
        const lines = text.trim().split('\n');
        
        lines.forEach(line => {
            if (line.includes(':')) {
                // New format: "1.0: 1;Amazonas" or "1.0: 1739;;;RI-Resguardo Indígena Tamaquito II"
                const [codeKey, rest] = line.split(':', 2);
                const numCode = parseFloat(codeKey.trim());
                
                if (!isNaN(numCode) && rest) {
                    // Split by ';' and get the last non-empty part as the name
                    const parts = rest.split(';');
                    const name = parts.filter(part => part.trim()).pop();
                    
                    if (name && name.trim()) {
                        mapping[numCode] = name.trim();
                    }
                }
            }
        });
        
        return mapping;
    }

    parsePalette(text) {
        const mapping = {};
        const lines = text.trim().split('\n');
        
        if (lines.length < 2) return mapping;
        
        // Parse header to find column indices
        const header = lines[0].split(';');
        const espIndex = header.indexOf('ESP');
        const idIndex = header.indexOf('ID');
        const colorIndex = header.indexOf('Color number');
        
        if (espIndex === -1 || idIndex === -1) {
            return mapping;
        }
        
        lines.slice(1).forEach(line => { // Skip header
            const parts = line.split(';');
            if (parts.length > Math.max(espIndex, idIndex)) {
                const id = parseFloat(parts[idIndex]);
                const name = parts[espIndex];
                const color = colorIndex !== -1 ? parts[colorIndex] : null;
                
                if (!isNaN(id) && name && name.trim()) {
                    // Clean the name (remove number prefix if present)
                    const cleanName = name.includes('. ') ? name.split('. ')[1] : name;
                    mapping[id] = {
                        name: cleanName.trim(),
                        color: color ? color.trim() : null,
                        fullName: name.trim()
                    };
                    
                    // Log for first few entries (removed debug output)
                }
            }
        });
        
        return mapping;
    }

    updateFilters() {
        // Update year range - optimized for large datasets
        let minYear = Infinity;
        let maxYear = -Infinity;
        
        // Single pass through data instead of creating large arrays
        for (const row of this.data) {
            const year = row.year;
            if (!isNaN(year)) {
                if (year < minYear) minYear = year;
                if (year > maxYear) maxYear = year;
            }
        }
        
        // Update navbar year dropdowns
        const yearMinInput = document.getElementById('yearMinInput');
        const yearMaxInput = document.getElementById('yearMaxInput');
        
        if (yearMinInput) {
            yearMinInput.innerHTML = '';
            for (let year = minYear; year <= maxYear; year++) {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                if (year === minYear) option.selected = true;
                yearMinInput.appendChild(option);
            }
        }
        
        if (yearMaxInput) {
            yearMaxInput.innerHTML = '';
            for (let year = minYear; year <= maxYear; year++) {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                if (year === maxYear) option.selected = true;
                yearMaxInput.appendChild(option);
            }
        }
        
        this.filters.yearMin = minYear;
        this.filters.yearMax = maxYear;
        
        // Update territory filters
        this.updateTerritoryFilters();
        
        // Update coverage filters
        this.updateCoverageFilters();
        
        // Update map filters
        this.updateMapFilters();
    }

    updateTerritoryFilters() {
        // Optimized unique territory extraction for large datasets
        const territoriesSet = new Set();
        for (const row of this.data) {
            if (row.territory !== undefined) {
                territoriesSet.add(row.territory);
            }
        }
        const territories = Array.from(territoriesSet);
        const container = document.getElementById('territoryFilters');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.filters.territories.clear();
        
        territories.forEach(territory => {
            let territoryName = '';
            
            // Use the barchart column from data source configuration for human-readable names
            const currentSource = this.dataSources[this.currentDataSource];
            if (currentSource && currentSource.barchart) {
                // Get the spatial data for this territory
                const currentSourceMappings = this.spatialTabularMappings[this.currentDataSource] || {};
                const spatialData = currentSourceMappings[territory];
                
                if (spatialData && spatialData[currentSource.barchart]) {
                    territoryName = spatialData[currentSource.barchart];
                }
            }
            
            // Fallback to territory names mapping or raw territory ID
            if (!territoryName) {
                territoryName = this.territoryNames[territory] || territory;
            }
            
            // Clean up the name for better display
            territoryName = territoryName.replace(/Resguardo Indígena/gi, 'R.I.');
            territoryName = territoryName.replace(/RI-Resguardo Indígena/gi, 'R.I.');
            
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = false; // Start with no territories selected by default
            checkbox.value = territory;
            
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.filters.territories.add(territory);
                } else {
                    this.filters.territories.delete(territory);
                }
                this.applyFilters();
            });
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(territoryName));
            container.appendChild(label);
            
            // Don't add territory to filters by default - let user select what they want
        });
    }

    updateCoverageFilters() {
        // Optimized unique coverage extraction for large datasets
        const coveragesSet = new Set();
        for (const row of this.data) {
            if (row.class !== undefined) {
                coveragesSet.add(row.class);
            }
        }
        const coverages = Array.from(coveragesSet);
        const container = document.getElementById('coverageFilters');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.filters.coverages.clear();
        
        coverages.forEach(coverage => {
            const coverageInfo = this.coverageNames[coverage];
            const coverageName = coverageInfo ? coverageInfo.name : `Clase ${coverage}`;
            
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = false; // Start with no coverages selected by default
            checkbox.value = coverage;
            
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.filters.coverages.add(coverage);
                } else {
                    this.filters.coverages.delete(coverage);
                }
                this.applyFilters();
            });
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(coverageName));
            container.appendChild(label);
            
            // Don't add coverage to filters by default - let user select what they want
        });
    }

    applyFilters() {
        this.showFilterLoading(true);
        
        // Use setTimeout to allow the loading indicator to show
        setTimeout(() => {
            this.filteredData = this.data.filter(row => {
                // Year filter
                if (row.year < this.filters.yearMin || row.year > this.filters.yearMax) {
                    return false;
                }
                
                // Territory filter
                if (this.filters.territories.size > 0 && !this.filters.territories.has(row.territory)) {
                    return false;
                }
                
                // Coverage filter
                if (this.filters.coverages.size > 0 && !this.filters.coverages.has(row.class)) {
                    return false;
                }
                
                return true;
            });
            
            this.updateCharts();
            this.updateTable();
            this.updateMetrics();
            this.updateMap(); // Update map popups to reflect new filters
            
            // Hide loading indicator after a shorter delay
            setTimeout(() => {
                this.showFilterLoading(false);
            }, 100);
        }, 20);
    }

    // Get data for forest change and heatmap charts with special logic
    getDataForSpecificCharts() {
        return this.data.filter(row => {
            // Year filter - always apply
            if (row.year < this.filters.yearMin || row.year > this.filters.yearMax) {
                return false;
            }
            
            // Territory filter - apply if active
            if (this.filters.territories.size > 0 && !this.filters.territories.has(row.territory)) {
                return false;
            }
            
            // Coverage filter - if no coverage filter is active, default to class 3 (forest)
            // If coverage filter is active, respect it
            if (this.filters.coverages.size > 0) {
                if (!this.filters.coverages.has(row.class)) {
                    return false;
                }
            } else {
                // No coverage filter active - default to class 3 (formación forestal)
                if (row.class !== 3) {
                    return false;
                }
            }
            
            return true;
        });
    }

    // Get coverage names for chart titles
    getCoverageNamesForTitle() {
        if (this.filters.coverages.size > 0) {
            // Use selected coverage(s)
            const selectedCoverages = Array.from(this.filters.coverages).map(classId => {
                const coverageInfo = this.coverageNames[classId];
                return coverageInfo ? coverageInfo.name : `Clase ${classId}`;
            });
            return selectedCoverages.join(', ');
        } else {
            // Default to Formación Forestal (class 3)
            const coverageInfo = this.coverageNames[3];
            return coverageInfo ? coverageInfo.name : 'Formación Forestal';
        }
    }

    setupMap() {
        // Initialize Leaflet map
        this.map = L.map('mapContainer').setView([4.5709, -74.2973], 6); // Colombia center
        
        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);
        
        // Create legend control
        this.createMapLegendControl();
    }

    createMapLegendControl() {
        // Create custom legend control
        const LegendControl = L.Control.extend({
            onAdd: function(map) {
                const div = L.DomUtil.create('div', 'leaflet-map-legend');
                div.id = 'leafletMapLegend';
                div.innerHTML = `
                    <div class="leaflet-legend-content">
                        <div class="legend-header-with-toggle">
                            <h4>Leyenda</h4>
                            <button id="legendToggleBtn" class="legend-toggle-btn" title="Ocultar/Mostrar leyenda">
                                <span class="toggle-icon">−</span>
                            </button>
                        </div>
                        <div id="leafletLegendItems" class="legend-content">
                            <div class="legend-item">
                                <div class="legend-header">
                                    <p class="legend-subtitle">Selecciona un año para ver el mapa coropléthico</p>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                
                // Add toggle functionality
                setTimeout(() => {
                    const toggleBtn = document.getElementById('legendToggleBtn');
                    const legendContent = document.getElementById('leafletLegendItems');
                    const toggleIcon = toggleBtn.querySelector('.toggle-icon');
                    
                    if (toggleBtn && legendContent) {
                        toggleBtn.addEventListener('click', function(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            if (legendContent.style.display === 'none') {
                                legendContent.style.display = 'block';
                                toggleIcon.textContent = '−';
                            } else {
                                legendContent.style.display = 'none';
                                toggleIcon.textContent = '+';
                            }
                        });
                    }
                }, 100);
                return div;
            },
            onRemove: function(map) {
                // Nothing to do here
            }
        });

        // Add legend control to map
        this.mapLegendControl = new LegendControl({ position: 'topright' });
        this.mapLegendControl.addTo(this.map);
    }

    createEnhancedPopup(feature, layer) {
        // Use the SAME successful logic as createEnhancedPopupLegacy but with map filters
        
        // Get CSV data for this feature using map filters
        const csvData = this.getCSVDataForFeatureWithMapFilters(feature);
        // Get data for time series chart (only coverage filter, not year filter)
        const allTerritoryData = this.getCSVDataForFeatureTimeSeriesChart(feature);
        
        // Start building popup content
        let popupContent = '';
        
        // Create unique chart ID (same as legacy)
        const chartId = `popup-chart-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        
        // Add CSV data if available
        if (csvData && csvData.length > 0) {
            // Add CSV metadata section
            popupContent += '<div class="popup-section">';
            popupContent += '<div class="popup-section-title">📋 Información del Registro</div>';
            popupContent += this.createCSVMetadataSection(csvData);
            popupContent += '</div>';
            
            // Add temporal evolution chart section
            popupContent += '<div class="popup-section">';
            popupContent += `<div class="popup-section-title">📈 Evolución Temporal de Coberturas</div>`;
            
            // Add chart container
            popupContent += `<div class="popup-chart-container">`;
            popupContent += `<canvas id="${chartId}" width="400" height="250"></canvas>`;
            popupContent += `</div>`;
            
            // Total area summary (using filtered data)
            const totalArea = allTerritoryData.reduce((sum, row) => sum + (parseFloat(row.area) || 0), 0);
            const uniqueYears = [...new Set(allTerritoryData.map(d => d.year))].sort((a, b) => a - b);
            const yearRange = uniqueYears.length > 0 ? `${uniqueYears[0]} - ${uniqueYears[uniqueYears.length - 1]}` : '';
            
            popupContent += `<div class="total-area">`;
            popupContent += `Área total (${yearRange}): ${totalArea.toFixed(2)} km²`;
            popupContent += '</div>';
            popupContent += '</div>';
            
        } else {
            popupContent += '<div class="popup-section">';
            popupContent += '<div style="color: #666; font-style: italic;">';
            popupContent += 'No hay datos de cobertura disponibles para este territorio con los filtros actuales.';
            popupContent += '</div>';
            popupContent += '</div>';
        }
        
        // Set popup with enhanced content (same as legacy)
        layer.bindPopup(popupContent, {
            maxWidth: 450, // Wider for chart
            className: 'enhanced-popup'
        });

        // Create chart after popup opens (SAME logic as legacy)
        if (allTerritoryData && allTerritoryData.length > 0) {
            layer.on('popupopen', () => {
                // Wait for popup to be fully rendered (same as legacy)
                setTimeout(() => {
                    this.createPopupTimeSeriesChart(chartId, allTerritoryData);
                }, 200);
            });

            // Cleanup chart when popup closes (SAME as legacy)
            layer.on('popupclose', () => {
                const existingChart = this.popupCharts.get(chartId);
                if (existingChart) {
                    existingChart.destroy();
                    this.popupCharts.delete(chartId);
                }
            });
        }
    }


    getCSVDataForFeatureWithMapFilters(feature) {
        // Get the id_area from GeoJSON properties
        const idArea = feature.properties.id_area;
        if (!idArea) {
            return [];
        }
        
        // Convert GeoJSON id_area to CSV territory using codes mapping
        const csvTerritory = this.convertIdAreaToTerritory(idArea);
        if (!csvTerritory) {
            return [];
        }
        
        // Start with all data for this territory
        let filteredData = this.data.filter(row => 
            row.territory.toString() === csvTerritory.toString()
        );
        
        // Apply map-specific filters
        const mapCoverageFilter = document.getElementById('mapCoverageFilter');
        const mapYearFilter = document.getElementById('mapYearFilter');
        
        const selectedCoverage = mapCoverageFilter ? mapCoverageFilter.value : '';
        const selectedYear = mapYearFilter ? mapYearFilter.value : '';
        
        if (selectedCoverage) {
            filteredData = filteredData.filter(row => row.class.toString() === selectedCoverage.toString());
        }
        
        if (selectedYear) {
            filteredData = filteredData.filter(row => row.year.toString() === selectedYear.toString());
        }
        
        return filteredData;
    }

    getCSVDataForFeatureTimeSeriesChart(feature) {
        // Get CSV data for time series chart - apply only coverage filter, NOT year filter
        // This allows the chart to show complete temporal evolution
        
        const idArea = feature.properties.id_area;
        if (!idArea) {
            return [];
        }
        
        // Convert GeoJSON id_area to CSV territory using codes mapping
        const csvTerritory = this.convertIdAreaToTerritory(idArea);
        if (!csvTerritory) {
            return [];
        }
        
        // Start with all data for this territory (all years)
        let filteredData = this.data.filter(row => 
            row.territory.toString() === csvTerritory.toString()
        );
        
        // Apply ONLY map coverage filter (not year filter)
        const mapCoverageFilter = document.getElementById('mapCoverageFilter');
        const selectedCoverage = mapCoverageFilter ? mapCoverageFilter.value : '';
        
        if (selectedCoverage) {
            filteredData = filteredData.filter(row => row.class.toString() === selectedCoverage.toString());
        }
        
        return filteredData;
    }


    clearMapLayers() {
        // Clear all GIS layers from the map
        if (this.mapLayer) {
            this.map.removeLayer(this.mapLayer);
            this.mapLayer = null;
        }
        
        // Also clear any other layers that might exist
        this.map.eachLayer((layer) => {
            // Keep the base tile layer, remove everything else
            if (layer instanceof L.TileLayer) {
                return; // Keep tile layers
            }
            this.map.removeLayer(layer);
        });
    }

    setupCharts() {
        // Check if mobile device
        const isMobile = window.innerWidth <= 768;
        
        // Time Series Chart
        const timeCtx = document.getElementById('timeSeriesChart').getContext('2d');
        this.charts.timeSeries = new Chart(timeCtx, {
            type: 'line',
            data: {
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Evolución de Top 10 Coberturas por Área Total',
                        font: {
                            size: isMobile ? 12 : 16
                        }
                    },
                    legend: {
                        position: isMobile ? 'bottom' : 'top',
                        labels: {
                            font: {
                                size: isMobile ? 10 : 12
                            },
                            boxWidth: isMobile ? 12 : 40
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        titleFont: {
                            size: isMobile ? 12 : 14
                        },
                        bodyFont: {
                            size: isMobile ? 11 : 13
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: {
                            display: !isMobile,
                            text: 'Año',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        ticks: {
                            font: {
                                size: isMobile ? 9 : 11
                            }
                        }
                    },
                    y: {
                        title: {
                            display: !isMobile,
                            text: 'Área Total (km²)',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        ticks: {
                            font: {
                                size: isMobile ? 9 : 11
                            }
                        }
                    }
                }
            }
        });

        // Coverage Change Heatmap Chart
        const heatmapCtx = document.getElementById('coverageChangeHeatmap').getContext('2d');
        this.charts.heatmap = new Chart(heatmapCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    title: {
                        display: true,
                        text: '',  // Will be updated dynamically
                        font: {
                            size: isMobile ? 12 : 16
                        }
                    },
                    legend: {
                        display: true,
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.parsed.x;
                                const sign = value >= 0 ? '+' : '';
                                return `${context.dataset.label}: ${sign}${value.toFixed(2)} km²`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: !isMobile,
                            text: 'Cambio en Área (km²)',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        ticks: {
                            font: {
                                size: isMobile ? 9 : 11
                            }
                        }
                    },
                    y: {
                        title: {
                            display: !isMobile,
                            text: 'Territorio',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        ticks: {
                            font: {
                                size: isMobile ? 8 : 10
                            }
                        }
                    }
                }
            }
        });

        // Territory Chart
        const territoryCtx = document.getElementById('territoryChart').getContext('2d');
        this.charts.territory = new Chart(territoryCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Área Total (km²)',
                    data: [],
                    backgroundColor: 'rgba(46, 134, 171, 0.8)',
                    borderColor: 'rgba(46, 134, 171, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: isMobile ? 'y' : 'x', // Horizontal bars on mobile
                plugins: {
                    title: {
                        display: true,
                        text: 'Top 10 Territorios por Área Total',
                        font: {
                            size: isMobile ? 12 : 16
                        }
                    },
                    legend: {
                        display: !isMobile
                    },
                    tooltip: {
                        titleFont: {
                            size: isMobile ? 12 : 14
                        },
                        bodyFont: {
                            size: isMobile ? 11 : 13
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: !isMobile,
                            text: isMobile ? '' : 'Territorios',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        ticks: {
                            font: {
                                size: isMobile ? 8 : 10
                            },
                            maxRotation: isMobile ? 0 : 45
                        }
                    },
                    y: {
                        title: {
                            display: !isMobile,
                            text: 'Área Total (km²)',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        ticks: {
                            font: {
                                size: isMobile ? 9 : 11
                            }
                        }
                    }
                }
            }
        });

        // Coverage Chart
        const coverageCtx = document.getElementById('coverageChart').getContext('2d');
        this.charts.coverage = new Chart(coverageCtx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [] // Will be populated dynamically with palette colors
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Top 10 Coberturas por Área Total',
                        font: {
                            size: isMobile ? 12 : 16
                        }
                    },
                    legend: {
                        position: isMobile ? 'bottom' : 'right',
                        labels: {
                            font: {
                                size: isMobile ? 9 : 11
                            },
                            boxWidth: isMobile ? 12 : 20,
                            padding: isMobile ? 10 : 20,
                            generateLabels: function(chart) {
                                const data = chart.data;
                                if (data.labels.length && data.datasets.length) {
                                    return data.labels.map((label, i) => {
                                        const dataset = data.datasets[0];
                                        const backgroundColor = dataset.backgroundColor[i];
                                        
                                        // Split long labels into multiple lines
                                        const maxLength = isMobile ? 15 : 20;
                                        let displayText = label;
                                        if (label.length > maxLength) {
                                            const words = label.split(' ');
                                            if (words.length > 1) {
                                                const midPoint = Math.ceil(words.length / 2);
                                                displayText = [
                                                    words.slice(0, midPoint).join(' '),
                                                    words.slice(midPoint).join(' ')
                                                ];
                                            }
                                        }
                                        
                                        return {
                                            text: displayText,
                                            fillStyle: backgroundColor,
                                            strokeStyle: backgroundColor,
                                            lineWidth: 0,
                                            index: i
                                        };
                                    });
                                }
                                return [];
                            }
                        }
                    },
                    tooltip: {
                        titleFont: {
                            size: isMobile ? 12 : 14
                        },
                        bodyFont: {
                            size: isMobile ? 11 : 13
                        }
                    }
                }
            }
        });

        // Forest Change Chart - Shows annual change in forest area
        const forestChangeCtx = document.getElementById('forestChangeChart').getContext('2d');
        this.charts.forestChange = new Chart(forestChangeCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Cambio Anual (km²)',
                    data: [],
                    borderColor: 'rgba(46, 125, 50, 1)', // Forest green
                    backgroundColor: function(context) {
                        const value = context.parsed ? context.parsed.y : 0;
                        return value >= 0 ? 'rgba(76, 175, 80, 0.3)' : 'rgba(244, 67, 54, 0.3)'; // Green for gain, red for loss
                    },
                    borderWidth: 2,
                    fill: {
                        target: 'origin',
                        above: 'rgba(76, 175, 80, 0.2)', // Green fill above zero
                        below: 'rgba(244, 67, 54, 0.2)'  // Red fill below zero
                    },
                    pointBackgroundColor: function(context) {
                        const value = context.parsed ? context.parsed.y : 0;
                        return value >= 0 ? 'rgba(76, 175, 80, 1)' : 'rgba(244, 67, 54, 1)';
                    },
                    pointBorderColor: 'white',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Cambio Anual de Área Forestal (Clase 3)',
                        font: {
                            size: isMobile ? 12 : 16
                        }
                    },
                    legend: {
                        display: !isMobile
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.parsed.y;
                                const sign = value >= 0 ? '+' : '';
                                return `${context.dataset.label}: ${sign}${value.toFixed(2)} km²`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: !isMobile,
                            text: 'Año',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        }
                    },
                    y: {
                        title: {
                            display: !isMobile,
                            text: 'Cambio (km²)',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        beginAtZero: true,
                        grid: {
                            color: function(context) {
                                return context.tick.value === 0 ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.1)';
                            }
                        }
                    }
                }
            }
        });
        
        // Add resize listener to update charts on orientation change
        window.addEventListener('resize', () => {
            setTimeout(() => {
                Object.values(this.charts).forEach(chart => {
                    if (chart) {
                        chart.resize();
                    }
                });
            }, 100);
        });
    }

    updateCharts() {
        this.updateTimeSeriesChart();
        this.updateTerritoryChart();
        this.updateCoverageChart();
        this.updateForestChangeChart();
        this.updateHeatmapChart();
    }

    updateTableYearFilter() {
        const tableYearFilter = document.getElementById('tableYearFilter');
        if (!tableYearFilter) return;
        
        // Get unique years from ALL data (not filtered data)
        const years = [...new Set(this.data.map(d => d.year))].sort((a, b) => a - b);
        
        // Store current selection
        const currentValue = tableYearFilter.value;
        
        // Clear and repopulate options
        tableYearFilter.innerHTML = '<option value="">Todos los años</option>';
        
        years.forEach(year => {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            if (year.toString() === currentValue) {
                option.selected = true;
            }
            tableYearFilter.appendChild(option);
        });
    }

    updateMapFilters() {
        // Update map coverage filter
        const coverageFilter = document.getElementById('mapCoverageFilter');
        if (coverageFilter) {
            const coverages = [...new Set(this.data.map(d => d.class))].sort((a, b) => a - b);
            
            // Reset to default option when data source changes
            coverageFilter.innerHTML = '<option value="">Todas las coberturas</option>';
            
            coverages.forEach(coverage => {
                const option = document.createElement('option');
                option.value = coverage;
                const coverageInfo = this.coverageNames[coverage];
                option.textContent = coverageInfo ? coverageInfo.name : `Clase ${coverage}`;
                coverageFilter.appendChild(option);
            });
            
            // Reset selection to default
            coverageFilter.value = '';
        }
        
        // Update map year filter
        const yearFilter = document.getElementById('mapYearFilter');
        if (yearFilter) {
            const years = [...new Set(this.data.map(d => d.year))].sort((a, b) => a - b);
            
            // Reset to default option when data source changes
            yearFilter.innerHTML = '<option value="">Todos los años</option>';
            
            years.forEach(year => {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                yearFilter.appendChild(option);
            });
            
            // Reset selection to default
            yearFilter.value = '';
        }
    }

    updateTimeSeriesChart() {
        // Group by year and coverage, sum areas
        const timeData = {};
        
        this.filteredData.forEach(row => {
            const year = row.year;
            const coverage = row.class;
            const area = parseFloat(row.area) || 0;
            
            if (!timeData[coverage]) {
                timeData[coverage] = {};
            }
            
            if (!timeData[coverage][year]) {
                timeData[coverage][year] = 0;
            }
            
            timeData[coverage][year] += area;
        });

        // Get top 10 coverages by total area
        const coverageTotals = {};
        Object.keys(timeData).forEach(coverage => {
            coverageTotals[coverage] = Object.values(timeData[coverage]).reduce((a, b) => a + b, 0);
        });

        const topCoverages = Object.keys(coverageTotals)
            .sort((a, b) => coverageTotals[b] - coverageTotals[a])
            .slice(0, 10);

        // Create datasets
        const datasets = topCoverages.map((coverage, index) => {
            const data = Object.keys(timeData[coverage]).map(year => ({
                x: parseInt(year),
                y: timeData[coverage][year]
            }));

            const coverageInfo = this.coverageNames[coverage];
            const coverageName = coverageInfo ? coverageInfo.name : `Clase ${coverage}`;
            const color = coverageInfo && coverageInfo.color ? coverageInfo.color : this.getColor(index);
            
            // Log for first few colors (removed debug output)
            
            return {
                label: coverageName,
                data: data,
                borderColor: color,
                backgroundColor: color, // Use solid color instead of transparent
                fill: false, // Don't fill the area under the line
                tension: 0.4,
                borderWidth: 2
            };
        });

        this.charts.timeSeries.data.datasets = datasets;
        this.charts.timeSeries.update();
    }

    updateTerritoryChart() {
        // Group by territory, sum areas
        const territoryData = {};
        
        this.filteredData.forEach(row => {
            const territory = row.territory;
            const area = parseFloat(row.area) || 0;
            
            if (!territoryData[territory]) {
                territoryData[territory] = 0;
            }
            
            territoryData[territory] += area;
        });

        // Get the maximum number of territories to show - always top 10
        let maxItems = 10; // 🔧 CONFIGURABLE: Show top 10 territories for all data sources
        
        // Sort and take top N territories
        const sortedTerritories = Object.entries(territoryData)
            .sort(([,a], [,b]) => b - a)
            .slice(0, maxItems);

        const labels = sortedTerritories.map(([territory]) => {
            let label = '';
            
            // Use the barchart column from data source configuration
            const currentSource = this.dataSources[this.currentDataSource];
            if (currentSource && currentSource.barchart) {
                // Get the spatial data for this territory
                const currentSourceMappings = this.spatialTabularMappings[this.currentDataSource] || {};
                const spatialData = currentSourceMappings[territory];
                
                if (spatialData && spatialData[currentSource.barchart]) {
                    label = spatialData[currentSource.barchart];
                }
            }
            
            // Fallback to territory names mapping or raw territory ID
            if (!label) {
                label = this.territoryNames[territory] || territory;
            }
            
            // Replace "Resguardo Indígena" with "R.I" for cleaner display
            label = label.replace(/Resguardo Indígena/gi, 'R.I');
            label = label.replace(/RI-Resguardo Indígena/gi, 'R.I');
            
            return label;
        });
        const data = sortedTerritories.map(([,area]) => area);
        
        // Use a consistent color scheme for territories
        const territoryColor = '#2E86AB'; // Blue color
        const backgroundColor = sortedTerritories.map((_, index) => 
            this.hexToRgba(territoryColor, 0.8 - (index * 0.02)) // Gradient effect
        );
        const borderColor = sortedTerritories.map(() => territoryColor);

        // Update chart title dynamically based on data source and actual number of items shown
        let chartTitle = `Top ${maxItems} Territorios por Área Total`;
        if (this.currentDataSource === 'MASCARA') {
            chartTitle = 'Coberturas por Área de Análisis';
        }
        this.charts.territory.options.plugins.title.text = chartTitle;
        
        this.charts.territory.data.labels = labels;
        this.charts.territory.data.datasets[0].data = data;
        this.charts.territory.data.datasets[0].backgroundColor = backgroundColor;
        this.charts.territory.data.datasets[0].borderColor = borderColor;
        this.charts.territory.update();
    }

    updateCoverageChart() {
        // Group by coverage, sum areas
        const coverageData = {};
        
        this.filteredData.forEach(row => {
            const coverage = row.class;
            const area = parseFloat(row.area) || 0;
            
            if (!coverageData[coverage]) {
                coverageData[coverage] = 0;
            }
            
            coverageData[coverage] += area;
        });

        // Sort and take top 10
        const sortedCoverages = Object.entries(coverageData)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);

        const labels = sortedCoverages.map(([coverage]) => {
            const coverageInfo = this.coverageNames[coverage];
            return coverageInfo ? coverageInfo.name : `Clase ${coverage}`;
        });
        const data = sortedCoverages.map(([,area]) => area);
        
        // Get colors from palette
        const colors = sortedCoverages.map(([coverage], index) => {
            const coverageInfo = this.coverageNames[coverage];
            return coverageInfo && coverageInfo.color ? coverageInfo.color : this.getColor(index);
        });

        this.charts.coverage.data.labels = labels;
        this.charts.coverage.data.datasets[0].data = data;
        this.charts.coverage.data.datasets[0].backgroundColor = colors;
        this.charts.coverage.update();
    }

    updateForestChangeChart() {
        // Get data respecting navbar filters, but default to class 3 if no coverage filter is active
        const dataForChart = this.getDataForSpecificCharts();
        
        // Create dynamic title
        const coverageNames = this.getCoverageNamesForTitle();
        const title = `Evolución Anual de ${coverageNames}`;
        
        // Group data by year
        const forestByYear = {};
        dataForChart.forEach(row => {
            const year = row.year;
            const area = parseFloat(row.area) || 0;
            
            if (!forestByYear[year]) {
                forestByYear[year] = 0;
            }
            forestByYear[year] += area;
        });
        
        // Sort years and calculate year-over-year changes
        const years = Object.keys(forestByYear).map(year => parseInt(year)).sort((a, b) => a - b);
        const changes = [];
        const changeLabels = [];
        
        for (let i = 1; i < years.length; i++) {
            const currentYear = years[i];
            const previousYear = years[i - 1];
            
            const currentArea = forestByYear[currentYear] || 0;
            const previousArea = forestByYear[previousYear] || 0;
            
            const change = currentArea - previousArea;
            
            changes.push(change);
            changeLabels.push(`${previousYear}-${currentYear}`);
        }
        
        // Update chart title and data
        this.charts.forestChange.options.plugins.title.text = title;
        this.charts.forestChange.data.labels = changeLabels;
        this.charts.forestChange.data.datasets[0].data = changes;
        this.charts.forestChange.update();
    }

    updateHeatmapChart() {
        if (!this.charts.heatmap) return;

        console.log('🔥 Updating heatmap chart...');

        // Get data respecting navbar filters, but default to class 3 if no coverage filter is active
        const dataForChart = this.getDataForSpecificCharts();
        console.log('📊 Data for heatmap chart:', dataForChart.length);

        if (dataForChart.length === 0) {
            console.warn('⚠️ No data found for heatmap');
            return;
        }

        // Group data by territory and calculate recent changes (last 5 years)
        const territoryData = {};
        const currentYear = new Date().getFullYear();
        const recentYears = [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear];

        dataForChart.forEach(row => {
            const territory = row.territory;
            const year = parseInt(row.year);
            const area = parseFloat(row.area) || 0;

            if (!territoryData[territory]) {
                territoryData[territory] = {};
            }

            territoryData[territory][year] = area;
        });

        // Calculate year-over-year changes for recent years
        const territoryChanges = {};
        Object.keys(territoryData).forEach(territory => {
            const yearlyData = territoryData[territory];
            let totalChange = 0;
            let changeCount = 0;

            for (let i = 1; i < recentYears.length; i++) {
                const currentYear = recentYears[i];
                const previousYear = recentYears[i - 1];
                
                if (yearlyData[currentYear] !== undefined && yearlyData[previousYear] !== undefined) {
                    const change = yearlyData[currentYear] - yearlyData[previousYear];
                    totalChange += change;
                    changeCount++;
                }
            }

            if (changeCount > 0) {
                territoryChanges[territory] = totalChange / changeCount; // Average annual change
            }
        });

        console.log('📈 Territory changes calculated:', Object.keys(territoryChanges).length);

        // Get top 10 territories by total area
        const territoryTotals = {};
        dataForChart.forEach(row => {
            const territory = row.territory;
            const area = parseFloat(row.area) || 0;
            territoryTotals[territory] = (territoryTotals[territory] || 0) + area;
        });

        const topTerritories = Object.entries(territoryTotals)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([territory]) => territory);

        console.log('🏆 Top territories:', topTerritories.length);

        // Prepare chart data
        const labels = [];
        const changes = [];

        topTerritories.forEach(territory => {
            // Use exactly the same pattern as the territory bar chart
            let label = '';
            
            // Use the barchart column from data source configuration
            const currentSource = this.dataSources[this.currentDataSource];
            if (currentSource && currentSource.barchart) {
                // Get the spatial data for this territory
                const currentSourceMappings = this.spatialTabularMappings[this.currentDataSource] || {};
                const spatialData = currentSourceMappings[territory];
                
                if (spatialData && spatialData[currentSource.barchart]) {
                    label = spatialData[currentSource.barchart];
                }
            }
            
            // Fallback to territory names mapping or raw territory ID
            if (!label) {
                label = this.territoryNames[territory] || territory;
            }
            
            // Replace "Resguardo Indígena" with "R.I" for cleaner display (same as territory chart)
            if (label.includes('Resguardo Indígena')) {
                label = label.replace('Resguardo Indígena', 'R.I.');
            }

            labels.push(label);
            changes.push(territoryChanges[territory] || 0);
        });

        // Update chart title with current data source and coverage info
        const currentSource = this.dataSources[this.currentDataSource];
        const dataSourceName = currentSource ? currentSource.description : 'Territorio';
        const coverageNames = this.getCoverageNamesForTitle();
        const newTitle = `Cambio de ${coverageNames} por ${dataSourceName} (Últimos 5 Años)`;
        
        console.log('🏷️ Current data source:', this.currentDataSource);
        console.log('📋 Data source name:', dataSourceName);
        console.log('🔖 New title:', newTitle);
        
        this.charts.heatmap.options.plugins.title.text = newTitle;

        // Update chart
        this.charts.heatmap.data.labels = labels;
        this.charts.heatmap.data.datasets = [{
            label: 'Cambio Anual Promedio (km²)',
            data: changes,
            backgroundColor: changes.map(change => {
                if (change < 0) {
                    return 'rgba(244, 67, 54, 0.7)'; // Red for loss
                } else if (change > 0) {
                    return 'rgba(76, 175, 80, 0.7)'; // Green for gain
                } else {
                    return 'rgba(158, 158, 158, 0.7)'; // Gray for no change
                }
            }),
            borderColor: changes.map(change => {
                if (change < 0) {
                    return 'rgba(244, 67, 54, 1)';
                } else if (change > 0) {
                    return 'rgba(76, 175, 80, 1)';
                } else {
                    return 'rgba(158, 158, 158, 1)';
                }
            }),
            borderWidth: 1
        }];

        console.log('✅ Chart updated with', labels.length, 'territories');
        console.log('📝 Chart title updated to:', this.charts.heatmap.options.plugins.title.text);
        this.charts.heatmap.update();
    }

    updateMapPopups() {
        // Update popups with map-specific filters using the WORKING logic
        if (this.mapLayer) {
            this.mapLayer.eachLayer((layer) => {
                if (layer.feature && layer.feature.properties) {
                    // Use the SAME successful function but for map filters
                    this.createEnhancedPopup(layer.feature, layer);
                    
                    // Update choropleth styling if specific year is selected
                    this.updateChoroplethStyling(layer);
                }
            });
            
            // Update legend after updating all layers
            this.updateMapLegend();
        }
    }

    updateChoroplethStyling(layer) {
        const mapYearFilter = document.getElementById('mapYearFilter');
        const mapCoverageFilter = document.getElementById('mapCoverageFilter');
        
        if (!mapYearFilter || !mapCoverageFilter) return;
        
        const selectedYear = mapYearFilter.value;
        const selectedCoverage = mapCoverageFilter.value;
        
        
        // Only apply choropleth when a specific year is selected
        if (selectedYear && selectedYear !== '') {
            const territoryData = this.getChoroplethDataForTerritory(layer.feature, selectedYear, selectedCoverage);
            
            if (territoryData && territoryData.totalArea > 0) {
                // Calculate intensity based on total area for this territory
                const maxArea = this.getMaxAreaForChoropleth(selectedYear, selectedCoverage);
                const intensity = Math.min(territoryData.totalArea / maxArea, 1);
                
                // Apply choropleth styling
                const choroplethColor = this.getChoroplethColor(intensity);
                
                layer.setStyle({
                    fillColor: choroplethColor,
                    fillOpacity: 0.7,
                    color: '#666',
                    weight: 1
                });
            } else {
                // No data for this territory - use neutral gray
                layer.setStyle({
                    fillColor: '#d1d5db',
                    fillOpacity: 0.4,
                    color: '#9ca3af',
                    weight: 1
                });
            }
        } else {
            // Reset to default styling when no specific year is selected
            layer.setStyle({
                fillColor: '#3388ff',
                fillOpacity: 0.5,
                color: '#3388ff',
                weight: 2
            });
        }
    }

    getChoroplethDataForTerritory(feature, year, coverage) {
        const idArea = feature.properties.id_area;
        if (!idArea) return null;
        
        // Convert GeoJSON id_area to CSV territory using the SAME function as popups
        const csvTerritory = this.convertIdAreaToTerritory(idArea);
        if (!csvTerritory) {
            console.log('❌ Could not convert idArea to csvTerritory:', idArea);
            return null;
        }
        
        let filteredData = this.data.filter(row => {
            return row && row.territory && row.year &&
                   row.territory.toString() === csvTerritory.toString() && 
                   row.year.toString() === year.toString();
        });
        
        // Apply coverage filter if specified
        if (coverage && coverage !== '') {
            filteredData = filteredData.filter(row => 
                row && row.class && row.class.toString() === coverage.toString()
            );
        }
        
        // Sum total area for this territory
        const totalArea = filteredData.reduce((sum, row) => sum + parseFloat(row.area || 0), 0);
        
        return {
            totalArea: totalArea,
            records: filteredData
        };
    }

    getMaxAreaForChoropleth(year, coverage) {
        // Get all territories for the selected year/coverage combination
        let yearData = this.data.filter(row => 
            row && row.year && row.year.toString() === year.toString()
        );
        
        if (coverage && coverage !== '') {
            yearData = yearData.filter(row => 
                row && row.class && row.class.toString() === coverage.toString()
            );
        }
        
        // Group by territory and sum areas (same logic as working popups)
        const territoryTotals = {};
        yearData.forEach(row => {
            if (row && row.territory) {
                const territory = row.territory.toString();
                if (!territoryTotals[territory]) {
                    territoryTotals[territory] = 0;
                }
                territoryTotals[territory] += parseFloat(row.area || 0);
            }
        });
        
        // Return the maximum area among all territories
        const maxArea = Math.max(...Object.values(territoryTotals), 0);
        return maxArea > 0 ? maxArea : 1; // Avoid division by zero
    }

    getChoroplethColor(intensity) {
        // Color gradient from light green to dark green
        const minColor = { r: 199, g: 233, b: 192 }; // Light green
        const maxColor = { r: 27, g: 94, b: 32 };    // Dark green
        
        const r = Math.round(minColor.r + (maxColor.r - minColor.r) * intensity);
        const g = Math.round(minColor.g + (maxColor.g - minColor.g) * intensity);
        const b = Math.round(minColor.b + (maxColor.b - minColor.b) * intensity);
        
        return `rgb(${r}, ${g}, ${b})`;
    }

    updateMapLegend() {
        const legendItems = document.getElementById('leafletLegendItems');
        const legendTitle = document.querySelector('.leaflet-legend-content h4');
        const mapYearFilter = document.getElementById('mapYearFilter');
        const mapCoverageFilter = document.getElementById('mapCoverageFilter');
        
        console.log('🗺️ Updating map legend:', { 
            legendItems: !!legendItems, 
            legendTitle: !!legendTitle,
            mapYearFilter: !!mapYearFilter, 
            mapCoverageFilter: !!mapCoverageFilter 
        });
        
        if (!legendItems) {
            console.error('❌ Leaflet legend container not found!');
            return;
        }
        
        const selectedYear = mapYearFilter ? mapYearFilter.value : '';
        const selectedCoverage = mapCoverageFilter ? mapCoverageFilter.value : '';
        
        // Show choropleth legend only when a specific year is selected
        if (selectedYear && selectedYear !== '') {
            // Calculate max area for better context
            const maxArea = this.getMaxAreaForChoropleth(selectedYear, selectedCoverage);
            const maxAreaFormatted = maxArea > 1000 ? 
                `${(maxArea / 1000).toFixed(1)}k km²` : 
                `${maxArea.toFixed(1)} km²`;
            
            // Update legend title with filter information and add max area below title
            if (legendTitle) {
                const coverageName = selectedCoverage && this.coverageNames[selectedCoverage] 
                    ? this.coverageNames[selectedCoverage].name 
                    : 'todas las coberturas';
                
                legendTitle.innerHTML = `
                    Leyenda- ${coverageName} (${selectedYear})
                    <div class="legend-title-subtitle">
                        <small>📊 Área máxima: ${maxAreaFormatted}</small>
                    </div>
                `;
            }
            
            legendItems.innerHTML = `
                <div class="legend-item choropleth-legend">
                    <div class="choropleth-scale">
                        <div class="legend-section">
                            <h6>Intensidad de Área (km²)</h6>
                            <div class="scale-item">
                                <div class="color-box" style="background: rgb(199, 233, 192);"></div>
                                <span>Baja (0 - 33%)</span>
                            </div>
                            <div class="scale-item">
                                <div class="color-box" style="background: rgb(113, 163, 112);"></div>
                                <span>Media (34 - 66%)</span>
                            </div>
                            <div class="scale-item">
                                <div class="color-box" style="background: rgb(27, 94, 32);"></div>
                                <span>Alta (67 - 100%)</span>
                            </div>
                        </div>
                        <div class="legend-section">
                            <h6>Otros</h6>
                            <div class="scale-item">
                                <div class="color-box" style="background: #d1d5db; border: 1px solid #9ca3af;"></div>
                                <span>Sin datos disponibles</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Update legend title for general view
            if (legendTitle) {
                legendTitle.textContent = 'Leyenda- Vista General';
            }
            
            // Default legend when no specific year is selected
            legendItems.innerHTML = `
                <div class="legend-item">
                    <div class="choropleth-scale">
                        <div class="legend-section">
                            <h6>Territorios</h6>
                            <div class="scale-item">
                                <div class="color-box" style="background: #3388ff;"></div>
                                <span>Territorios con datos</span>
                            </div>
                        </div>
                    </div>
                    <div class="legend-note">
                        <small>💡 Selecciona un año específico para activar el mapa coroplético con escalas de color</small>
                    </div>
                </div>
            `;
        }
        
        console.log('✅ Map legend updated successfully');
    }

    updateTable() {
        const tbody = document.querySelector('#dataTable tbody');
        const dataCount = document.getElementById('dataCount');
        
        if (!tbody || !dataCount) return;
        
        // Get table year filter value
        const tableYearFilter = document.getElementById('tableYearFilter');
        const selectedYear = tableYearFilter ? tableYearFilter.value : '';
        
        // Apply table-specific year filter
        let tableData = this.filteredData;
        if (selectedYear) {
            tableData = this.filteredData.filter(row => row.year.toString() === selectedYear);
        }
        
        tbody.innerHTML = '';
        
        // Show first N rows based on configuration
        const displayData = tableData.slice(0, this.config.tableMaxRows);
        
        displayData.forEach((row) => {
            const tr = document.createElement('tr');
            
            // Use the barchart column from data source configuration for human-readable territory names
            let territoryName = '';
            
            const currentSource = this.dataSources[this.currentDataSource];
            if (currentSource && currentSource.barchart) {
                // Get the spatial data for this territory
                const currentSourceMappings = this.spatialTabularMappings[this.currentDataSource] || {};
                const spatialData = currentSourceMappings[row.territory];
                
                if (spatialData && spatialData[currentSource.barchart]) {
                    territoryName = spatialData[currentSource.barchart];
                }
            }
            
            // Fallback to territory names mapping or raw territory ID
            if (!territoryName) {
                territoryName = this.territoryNames[row.territory] || row.territory;
            }
            
            // Clean up the name for better display
            territoryName = territoryName.replace(/Resguardo Indígena/gi, 'R.I.');
            territoryName = territoryName.replace(/RI-Resguardo Indígena/gi, 'R.I.');
            const coverageInfo = this.coverageNames[row.class];
            const coverageName = coverageInfo ? coverageInfo.name : `Clase ${row.class}`;
            const area = parseFloat(row.area) || 0;
            
            tr.innerHTML = `
                <td>${territoryName}</td>
                <td>${coverageName}</td>
                <td>${row.year}</td>
                <td>${area.toFixed(2)}</td>
            `;
            
            tbody.appendChild(tr);
        });
        
        // Update data count
        dataCount.textContent = `${tableData.length.toLocaleString()} registros ${displayData.length < tableData.length ? `(mostrando ${displayData.length})` : ''}`;
    }

    updateMetrics() {
        // Use data filtered only by territory, NOT by coverage or years
        const dataForMetrics = this.data.filter(row => {            
            // Territory filter - apply if active
            if (this.filters.territories.size > 0 && !this.filters.territories.has(row.territory)) {
                return false;
            }
            
            // Don't apply year or coverage filters for metrics - we want to show complete overview
            return true;
        });

        if (dataForMetrics.length === 0) {
            this.clearMetrics();
            return;
        }

        const years = dataForMetrics.map(d => d.year);
        const minYear = Math.min(...years);
        const maxYear = Math.max(...years);

        // Calculate areas for specific classes
        const getAreaByYearClass = (year, classId) => {
            return dataForMetrics
                .filter(d => d.year === year && d.class === classId)
                .reduce((sum, d) => sum + (parseFloat(d.area) || 0), 0);
        };

        // Forest (class 3), Pasture (class 15), Agriculture (class 18)
        const forestInitial = getAreaByYearClass(minYear, 3);
        const forestFinal = getAreaByYearClass(maxYear, 3);
        const pastureInitial = getAreaByYearClass(minYear, 15);
        const pastureFinal = getAreaByYearClass(maxYear, 15);
        const agricultureInitial = getAreaByYearClass(minYear, 18);
        const agricultureFinal = getAreaByYearClass(maxYear, 18);

        // Update metrics
        document.getElementById('forestArea').textContent = this.formatArea(forestFinal);
        document.getElementById('forestChange').textContent = this.formatChangeWithPeriod(forestFinal - forestInitial, minYear, maxYear);
        
        document.getElementById('pastureArea').textContent = this.formatArea(pastureFinal);
        document.getElementById('pastureChange').textContent = this.formatChangeWithPeriod(pastureFinal - pastureInitial, minYear, maxYear);
        
        document.getElementById('agricultureArea').textContent = this.formatArea(agricultureFinal);
        document.getElementById('agricultureChange').textContent = this.formatChangeWithPeriod(agricultureFinal - agricultureInitial, minYear, maxYear);
        
        // Territory count with dynamic title
        const totalTerritories = new Set(dataForMetrics.map(d => d.territory)).size;
        const allTerritories = new Set(this.data.map(d => d.territory)).size;
        const territoryPercent = ((totalTerritories / allTerritories) * 100).toFixed(1);
        
        // Update territory title dynamically based on data source
        const currentSource = this.dataSources[this.currentDataSource];
        const dataSourceName = currentSource ? currentSource.description : 'Territorios';
        document.getElementById('totalTerritoriesTitle').textContent = `Total ${dataSourceName}`;
        
        document.getElementById('totalTerritories').textContent = totalTerritories;
        document.getElementById('territoryPercent').textContent = `${territoryPercent}% del total`;
    }

    clearMetrics() {
        ['forestArea', 'forestChange', 'pastureArea', 'pastureChange', 
         'agricultureArea', 'agricultureChange', 'totalTerritories', 'territoryPercent'].forEach(id => {
            document.getElementById(id).textContent = '-';
        });
    }

    formatArea(area) {
        if (area >= 1000000) {
            return `${(area / 1000000).toFixed(1)}M km²`;
        } else if (area >= 1000) {
            return `${(area / 1000).toFixed(1)}K km²`;
        } else {
            return `${area.toFixed(1)} km²`;
        }
    }

    formatChange(change) {
        const formatted = this.formatArea(Math.abs(change));
        return change >= 0 ? `+${formatted}` : `-${formatted}`;
    }

    formatChangeWithPeriod(change, startYear, endYear) {
        const formatted = this.formatArea(Math.abs(change));
        const sign = change >= 0 ? '+' : '-';
        const period = startYear === endYear ? `${startYear}` : `${startYear}-${endYear}`;
        return `${sign}${formatted} (${period})`;
    }

    getColor(index, alpha = 1) {
        const colors = [
            `rgba(255, 99, 132, ${alpha})`,
            `rgba(54, 162, 235, ${alpha})`,
            `rgba(255, 205, 86, ${alpha})`,
            `rgba(75, 192, 192, ${alpha})`,
            `rgba(153, 102, 255, ${alpha})`,
            `rgba(255, 159, 64, ${alpha})`,
            `rgba(199, 199, 199, ${alpha})`,
            `rgba(83, 102, 255, ${alpha})`,
            `rgba(255, 99, 255, ${alpha})`,
            `rgba(99, 255, 132, ${alpha})`
        ];
        return colors[index % colors.length];
    }

    hexToRgba(hex, alpha = 1) {
        if (!hex || !hex.startsWith('#')) {
            return `rgba(128, 128, 128, ${alpha})`; // Default gray
        }
        
        // Remove # and convert to RGB
        const hexValue = hex.substring(1);
        const r = parseInt(hexValue.substring(0, 2), 16);
        const g = parseInt(hexValue.substring(2, 4), 16);
        const b = parseInt(hexValue.substring(4, 6), 16);
        
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    setupNavbarFunctionality() {
        // Filters dropdown toggle
        const filtersToggle = document.getElementById('filtersToggle');
        const filtersDropdown = document.getElementById('filtersDropdown');
        const dropdown = filtersToggle?.parentElement;

        if (filtersToggle && dropdown) {
            filtersToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('active');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (dropdown && !dropdown.contains(e.target)) {
                    dropdown.classList.remove('active');
                }
            });

            // Prevent dropdown from closing when clicking inside
            if (filtersDropdown) {
                filtersDropdown.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }
        }

        // Year range inputs in navbar
        const yearMinInput = document.getElementById('yearMinInput');
        const yearMaxInput = document.getElementById('yearMaxInput');

        if (yearMinInput) {
            yearMinInput.addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                if (value <= this.filters.yearMax) {
                    this.filters.yearMin = value;
                    this.updateRangeSlider();
                }
            });
        }

        if (yearMaxInput) {
            yearMaxInput.addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                if (value >= this.filters.yearMin) {
                    this.filters.yearMax = value;
                    this.updateRangeSlider();
                }
            });
        }

        // Mobile menu toggle
        const mobileToggle = document.getElementById('mobileToggle');
        const mobileMenu = document.getElementById('mobileMenu');

        if (mobileToggle && mobileMenu) {
            mobileToggle.addEventListener('click', () => {
                mobileMenu.classList.toggle('active');
                mobileToggle.classList.toggle('active');
            });
        }
    }

    setupEventListeners() {
        // Helper function to safely add event listeners
        const safeAddEventListener = (elementId, event, handler) => {
            const element = document.getElementById(elementId);
            if (element) {
                element.addEventListener(event, handler);
            }
        };

        // Setup navbar functionality
        this.setupNavbarFunctionality();

        // Data source selector - always present
        safeAddEventListener('dataSource', 'change', (e) => {
            if (e.target.value) {
                this.loadDataSource(e.target.value);
            }
        });

        // Refresh button - always present
        safeAddEventListener('refreshBtn', 'click', () => {
            if (this.currentDataSource) {
                this.loadDataSource(this.currentDataSource);
            }
        });

        // Year range sliders - only in full dashboard
        // Note: Old slider and tooltip event listeners removed
        // Year inputs are now handled in the navbar section above

        // Search filters - only in full dashboard
        safeAddEventListener('territorySearch', 'input', (e) => {
            this.filterCheckboxes('territoryFilters', e.target.value);
        });

        safeAddEventListener('coverageSearch', 'input', (e) => {
            this.filterCheckboxes('coverageFilters', e.target.value);
        });

        // Export button - only in full dashboard
        safeAddEventListener('exportBtn', 'click', () => {
            this.exportToCSV();
        });

        // Table year filter - only in full dashboard
        safeAddEventListener('tableYearFilter', 'change', () => {
            this.updateTable();
        });

        // Map filters - independent from main dashboard filters
        safeAddEventListener('mapCoverageFilter', 'change', () => {
            this.updateMapPopups();
        });

        safeAddEventListener('mapYearFilter', 'change', () => {
            this.updateMapPopups();
        });

        // Territory filter buttons - only in full dashboard
        safeAddEventListener('selectAllTerritories', 'click', () => {
            this.selectAllFilters('territory', true);
        });

        safeAddEventListener('clearAllTerritories', 'click', () => {
            this.selectAllFilters('territory', false);
        });

        // Coverage filter buttons - only in full dashboard
        safeAddEventListener('selectAllCoverages', 'click', () => {
            this.selectAllFilters('coverage', true);
        });

        safeAddEventListener('clearAllCoverages', 'click', () => {
            this.selectAllFilters('coverage', false);
        });

        // Map controls removed - no longer needed


        // Sidebar controls
        safeAddEventListener('toggleControls', 'click', () => {
            this.toggleSidebar();
        });

        safeAddEventListener('closeSidebar', 'click', () => {
            this.closeSidebar();
        });

        safeAddEventListener('sidebarOverlay', 'click', () => {
            this.closeSidebar();
        });

        safeAddEventListener('applyFilters', 'click', () => {
            this.applySidebarFilters();
            this.closeSidebar();
        });
    }

    updateRangeSlider() {
        const yearMin = this.filters.yearMin;
        const yearMax = this.filters.yearMax;
        
        // Update navbar dropdown values
        const minInput = document.getElementById('yearMinInput');
        const maxInput = document.getElementById('yearMaxInput');
        
        if (minInput) {
            minInput.value = yearMin;
        }
        
        if (maxInput) {
            maxInput.value = yearMax;
        }
        
        // Note: The old sidebar had tooltips and progress bars, but the new navbar
        // uses simple dropdowns, so we only need to update the selected values
    }

    filterCheckboxes(containerId, searchTerm) {
        const container = document.getElementById(containerId);
        const labels = container.querySelectorAll('label');
        
        labels.forEach(label => {
            const text = label.textContent.toLowerCase();
            const matches = text.includes(searchTerm.toLowerCase());
            label.style.display = matches ? 'flex' : 'none';
        });
    }

    exportToCSV() {
        if (this.filteredData.length === 0) {
            alert('No hay datos para exportar');
            return;
        }

        const headers = ['Territorio', 'Cobertura', 'Año', 'Área (km²)'];
        const csvContent = [
            headers.join(','),
            ...this.filteredData.map(row => {
                const territoryName = this.territoryNames[row.territory] || row.territory;
                const coverageInfo = this.coverageNames[row.class];
                const coverageName = coverageInfo ? coverageInfo.name : `Clase ${row.class}`;
                const area = parseFloat(row.area) || 0;
                
                return [territoryName, coverageName, row.year, area.toFixed(2)].join(',');
            })
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `datos_amazonia_${this.currentDataSource}_${Date.now()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    showLoading(show) {
        const loading = document.getElementById('loadingIndicator');
        if (!loading) return;
        
        if (show) {
            loading.classList.remove('hidden');
        } else {
            loading.classList.add('hidden');
        }
    }

    showFilterLoading(show) {
        const filterLoading = document.getElementById('filterLoadingIndicator');
        if (!filterLoading) return;
        
        if (show) {
            filterLoading.classList.remove('hidden');
        } else {
            filterLoading.classList.add('hidden');
        }
    }

    showError(message) {
        alert(message);
    }

    selectAllFilters(filterType, select) {
        const containerId = filterType === 'territory' ? 'territoryFilters' : 'coverageFilters';
        const container = document.getElementById(containerId);
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        
        checkboxes.forEach(checkbox => {
            if (checkbox.style.display !== 'none') { // Only affect visible checkboxes
                checkbox.checked = select;
                
                // Trigger the change event to update the filter sets
                const event = new Event('change', { bubbles: true });
                checkbox.dispatchEvent(event);
            }
        });
    }

    updateMapControls() {
        // Update map legend
        this.updateMapLegend();
    }



    async updateMapDataForLayer(layerKey) {
        // Load data for the selected layer to update year and coverage selectors
        try {
            const layerConfig = this.dataSources[layerKey];
            const fileName = layerConfig.file;
            const response = await fetch(`./process/data/${fileName}`);
            
            if (!response.ok) {
                throw new Error(`Failed to load data for layer: ${response.status}`);
            }
            
            const csvText = await response.text();
            const layerData = this.parseCSV(csvText);
            
            // Store layer data for map updates
            this.currentMapData = layerData;
            
            // Update map with current filters
            this.updateMap();
            
        } catch (error) {
            // Failed to update map data for layer
        }
    }

    async loadGIS() {
        if (!this.currentDataSource || !this.dataSources[this.currentDataSource].gis) {
            return;
        }
        
        const geojsonPath = this.dataSources[this.currentDataSource].gis;
        
        try {
            // Remove existing layer if any
            this.clearMapLayers();
            
            // Load GeoJSON from AWS S3 or local fallback
            await this.loadGeoJSON(geojsonPath);
            
        } catch (error) {
            this.createDataVisualization();
        }
    }

    async loadGeoJSON(geojsonPath) {
        try {
            // Extract filename and construct AWS S3 URL (same as working mapa.html)
            const fileName = geojsonPath.split('/').pop();
            const awsUrl = `https://mb-colombia-data.s3.us-east-1.amazonaws.com/RAISG/${fileName}`;
            
            
            // Simple fetch approach that works in mapa.html (with cache bypass)
            const response = await fetch(awsUrl, {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });
            
            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error(`Access denied to ${fileName} - file may not exist or be accessible`);
                } else if (response.status === 404) {
                    throw new Error(`File ${fileName} not found in S3 bucket`);
                } else {
                    throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                }
            }
            
            
            // Direct JSON parsing (same as working mapa.html)
            const geojsonData = await response.json();
            
            
            // Display simple info on page
            this.displayGeoJSONInfo(geojsonPath, geojsonData, 'AWS S3');
            
            // Create and process the map layer with error handling
            try {
                this.createMapLayer(geojsonData);
            } catch (layerError) {
                if (layerError.message.includes('Maximum call stack size exceeded')) {
                } else {
                }
                return; // Exit successfully without throwing
            }
            
        } catch (awsError) {
            // Simple fallback to local file
            try {
                const localUrl = `./${geojsonPath}`;
                const response = await fetch(localUrl);
                
                if (!response.ok) {
                    throw new Error(`Local file error! status: ${response.status}`);
                }
                
                const geojsonData = await response.json();
                
                // Display simple info on page  
                this.displayGeoJSONInfo(geojsonPath, geojsonData, 'Local');
                
                // Create and process the map layer
                this.createMapLayer(geojsonData);
                
            } catch (localError) {
                throw new Error(`No se pudo cargar GeoJSON: AWS (${awsError.message}), Local (${localError.message})`);
            }
        }
    }

    validateFeatureGeometry(feature) {
        // Enhanced validation logic
        if (!feature.geometry) {
            return false;
        }
        
        if (!feature.geometry.coordinates) {
            return false;
        }
        
        // Additional validation for coordinate structure
        try {
            const coords = feature.geometry.coordinates;
            const geomType = feature.geometry.type;
            
            if (geomType === 'Polygon' && coords.length > 0) {
                // Check if first ring has at least 3 points
                if (!coords[0] || coords[0].length < 3) {
                    return false;
                }
                
                // Validate actual coordinate values
                for (let ring of coords) {
                    // Check for extremely complex geometries that might cause stack overflow
                    if (ring.length > 10000) {
                        return false;
                    }
                    
                    for (let point of ring) {
                        if (!Array.isArray(point) || point.length < 2) {
                            return false;
                        }
                        const [lng, lat] = point;
                        if (typeof lng !== 'number' || typeof lat !== 'number' || 
                            isNaN(lng) || isNaN(lat) || 
                            !isFinite(lng) || !isFinite(lat) ||
                            lng < -180 || lng > 180 || lat < -90 || lat > 90) {
                            return false;
                        }
                    }
                }
            } else if (geomType === 'MultiPolygon' && coords.length > 0) {
                // Similar validation for MultiPolygon
                for (let polygon of coords) {
                    for (let ring of polygon) {
                        if (!ring || ring.length < 3) continue;
                        for (let point of ring) {
                            if (!Array.isArray(point) || point.length < 2) {
                                return false;
                            }
                            const [lng, lat] = point;
                            if (typeof lng !== 'number' || typeof lat !== 'number' || 
                                isNaN(lng) || isNaN(lat) || 
                                !isFinite(lng) || !isFinite(lat) ||
                                lng < -180 || lng > 180 || lat < -90 || lat > 90) {
                                return false;
                            }
                        }
                    }
                }
            }
            
            return true;
        } catch (coordError) {
            return false;
        }
    }
    
    createMapLayer(geojsonData) {
        try {
            // Pre-validate and clean features (same approach as mapa.html)
            const validFeatures = [];
            const invalidFeatures = [];
            
            if (geojsonData.features) {
                geojsonData.features.forEach((feature, index) => {
                    if (this.validateFeatureGeometry(feature, index)) {
                        validFeatures.push(feature);
                    } else {
                        invalidFeatures.push(index);
                    }
                });
            }
            
            
            if (validFeatures.length === 0) {
                throw new Error('No se encontraron geometrías válidas');
            }
            
            // Create clean data structure (same as mapa.html)
            const cleanData = {
                type: "FeatureCollection",
                features: validFeatures
            };
            
            // Create Leaflet GeoJSON layer with clean data
            this.mapLayer = L.geoJSON(cleanData, {
                style: {
                    fillColor: '#3388ff',
                    weight: 2,
                    opacity: 1,
                    color: 'white',
                    dashArray: '3',
                    fillOpacity: 0.7
                },
                onEachFeature: (feature, layer) => {
                    try {
                        // Add popup functionality
                        this.createEnhancedPopupLegacy(feature, layer);
                    } catch (popupError) {
                        // Create a simple fallback popup
                        layer.bindPopup(`Error creating popup: ${popupError.message}`);
                    }
                }
                // No filter needed - we pre-validated features
            });
            
        } catch (layerError) {
            throw layerError;
        }
        
        // Add layer to map
        if (this.mapLayer) {
            this.mapLayer.addTo(this.map);
            
            // Fit map to show all features with error handling
            if (this.mapLayer.getLayers && this.mapLayer.getLayers().length > 0) {
                if (typeof this.mapLayer.getBounds === 'function') {
                    try {
                        const bounds = this.mapLayer.getBounds();
                        if (bounds && bounds.isValid && bounds.isValid()) {
                            this.map.fitBounds(bounds);
                        } else {
                            this.map.setView([4.5709, -74.2973], 5); // Default Colombia view
                        }
                    } catch (boundsError) {
                        this.map.setView([4.5709, -74.2973], 5); // Default Colombia view
                    }
                }
            }
            
            // Process the data for visualization
            this.processGeoJSON(geojsonData);
            
            // Update debug table with new GeoJSON info
        }
    }





    createDataVisualization() {
        
        // If map doesn't exist, reinitialize
        if (!this.map) {
            this.setupMap();
        }
        
        // Create markers for territories based on available data
        const territoryData = {};
        this.data.forEach(row => {
            if (!territoryData[row.territory]) {
                territoryData[row.territory] = {
                    area: 0,
                    count: 0,
                    classes: new Set()
                };
            }
            territoryData[row.territory].area += parseFloat(row.area) || 0;
            territoryData[row.territory].count += 1;
            territoryData[row.territory].classes.add(row.class);
        });
        
        // Clear existing layers
        if (this.mapLayer) {
            this.map.removeLayer(this.mapLayer);
        }
        
        // Create a layer group for markers
        this.mapLayer = L.layerGroup();
        
        // Add markers for territories (using approximate Colombia coordinates)
        const colombiaCoords = this.getColombiaCoordinates();
        let markerIndex = 0;
        
        Object.entries(territoryData).forEach(([territoryId, data]) => {
            const territoryName = this.territoryNames[territoryId] || `Territorio ${territoryId}`;
            
            // Use predefined coordinates or generate approximate ones
            const coords = colombiaCoords[markerIndex % colombiaCoords.length];
            markerIndex++;
            
            // Create marker with size based on area
            const maxArea = Math.max(...Object.values(territoryData).map(d => d.area));
            const normalizedSize = Math.max(5, Math.min(30, (data.area / maxArea) * 25));
            
            const marker = L.circleMarker(coords, {
                radius: normalizedSize,
                fillColor: '#3498db',
                color: '#2980b9',
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.6
            });
            
            // Add popup with territory information
            const popupContent = `
                <strong>${territoryName}</strong><br>
                <strong>Área Total:</strong> ${data.area.toFixed(2)} km²<br>
                <strong>Registros:</strong> ${data.count}<br>
                <strong>Coberturas:</strong> ${data.classes.size}
            `;
            
            marker.bindPopup(popupContent);
            this.mapLayer.addLayer(marker);
        });
        
        // Add layer to map
        this.mapLayer.addTo(this.map);
        
        // Fit map to show all markers
        if (this.mapLayer && this.mapLayer.getLayers && this.mapLayer.getLayers().length > 0) {
            if (typeof this.mapLayer.getBounds === 'function') {
                this.map.fitBounds(this.mapLayer.getBounds());
            }
        }
    }

    getColombiaCoordinates() {
        // Approximate coordinates for different regions of Colombia
        return [
            [4.7110, -74.0721], // Bogotá
            [6.2442, -75.5812], // Medellín
            [3.4516, -76.5320], // Cali
            [10.9639, -74.7964], // Barranquilla
            [7.8890, -72.4967], // Bucaramanga
            [4.8087, -75.6906], // Manizales
            [5.0689, -75.5174], // Pereira
            [4.5355, -75.6811], // Armenia
            [8.7405, -75.8819], // Montería
            [9.3068, -75.3975], // Sincelejo
            [2.9273, -75.2819], // Neiva
            [1.2136, -77.2811], // Pasto
            [5.3348, -72.3960], // Tunja
            [3.9897, -67.2653], // Villavicencio
            [2.4448, -76.6147], // Popayán
            [11.5404, -72.9077], // Riohacha
            [0.8242, -77.6779], // Ipiales
            [2.5230, -72.8979], // Florencia
            [5.8312, -73.3624], // Sogamoso
            [10.4631, -73.2536]  // Valledupar
        ];
    }

    processGeoJSON(geojson) {
        
        try {
            // Clear any previous bounds restrictions
            this.map.setMaxBounds(null);
            
            // Standard consistent style for all GeoJSON layers
            const standardStyle = {
                fillColor: '#3498db',
                weight: 2,
                opacity: 1,
                color: '#2980b9',
                fillOpacity: 0.6
            };
            
            this.mapLayer = L.geoJSON(geojson, {
                filter: (feature) => {
                    // Only include features that have valid CSV data
                    return this.hasValidDataForFeature(feature);
                },
                style: () => {
                    // Apply consistent style to all features
                    return standardStyle;
                },
                onEachFeature: (feature, layer) => {
                    // Apply standard style to ensure consistency
                    layer.setStyle(standardStyle);
                    
                    // Create enhanced popup with CSV data
                    this.createEnhancedPopupLegacy(feature, layer);
                }
            }).addTo(this.map);
            
            // Initialize legend after loading GeoJSON
            this.updateMapLegend();
            
            // Skip bounds calculation and use fixed coordinates for problematic layers
            this.map.setView([2.067735, -72.232948], 6); // Centered on Colombia's protected areas region
            
            // Skip bounds restrictions for now - use simple zoom limits
            this.map.setMinZoom(4); // Allow zooming out to see Colombia
            this.map.setMaxZoom(18); // Standard max zoom for satellite imagery
            
        } catch (error) {
            throw error;
        }
    }
    
    enhanceMapWithCSVData() {
        // Re-apply enhanced popups with CSV data
        this.mapLayer.eachLayer(layer => {
            const feature = layer.feature;
            if (feature) {
                // Update popup content with CSV data
                this.createEnhancedPopupLegacy(feature, layer);
            }
        });
    }

    getFeatureStyle(feature) {
        // Get the selected year and coverage for styling
        const selectedYear = document.getElementById('mapYear').value;
        const selectedCoverage = document.getElementById('mapCoverage').value;
        
        // Default style
        let style = {
            fillColor: '#3498db',
            weight: 2,
            opacity: 1,
            color: '#2980b9',
            fillOpacity: 0.7
        };
        
        // Try to get CSV data for this feature
        const csvData = this.getCSVDataForFeature(feature, selectedYear, selectedCoverage);
        
        if (csvData && csvData.length > 0) {
            // Calculate total area for this feature
            const totalArea = csvData.reduce((sum, row) => sum + (parseFloat(row.area) || 0), 0);
            
            // Color based on area (if we have coverage data)
            if (selectedCoverage) {
                const coverageData = csvData.find(row => row.class === selectedCoverage);
                if (coverageData) {
                    const area = parseFloat(coverageData.area) || 0;
                    // Color intensity based on area
                    const intensity = Math.min(area / 1000, 1); // Normalize to 0-1
                    style.fillColor = this.getColorByIntensity(intensity);
                    style.fillOpacity = 0.4 + (intensity * 0.4); // 0.4 to 0.8
                }
            } else {
                // No specific coverage selected, use total area
                const intensity = Math.min(totalArea / 5000, 1); // Normalize to 0-1
                style.fillColor = this.getColorByIntensity(intensity);
                style.fillOpacity = 0.4 + (intensity * 0.4);
            }
        }
        
        return style;
    }


    getColorByIntensity(intensity) {
        // Color gradient from light blue to dark blue
        const r = Math.round(52 + (255 - 52) * (1 - intensity));
        const g = Math.round(152 + (255 - 152) * (1 - intensity));
        const b = Math.round(219 + (255 - 219) * (1 - intensity));
        return `rgb(${r}, ${g}, ${b})`;
    }

    getCSVDataForFeature(feature, year, coverage) {
        // Get the id_area from GeoJSON properties
        const idArea = feature.properties.id_area;
        if (!idArea) {
            return [];
        }
        
        // Convert GeoJSON id_area to CSV territory using codes mapping
        const csvTerritory = this.convertIdAreaToTerritory(idArea);
        if (!csvTerritory) {
            return [];
        }
        
        // Always use original data for popups - users clicking on specific territories 
        // should see complete data for that territory, regardless of dashboard filters
        const dataToUse = this.data;
        
        // Filter data for this feature using the converted territory ID
        let featureData = dataToUse.filter(row => {
            const territoryId = row.territory ? row.territory.toString() : '';
            return territoryId === csvTerritory.toString();
        });
        
        // Filter by year if specified
        if (year) {
            featureData = featureData.filter(row => {
                // Handle both string and number comparisons
                const rowYear = row.year;
                const selectedYear = year;
                return rowYear == selectedYear; // Use == for flexible comparison
            });
            // After year filter
        }
        
        // Filter by coverage if specified
        if (coverage) {
            featureData = featureData.filter(row => {
                // Handle both string and number comparisons
                const rowClass = row.class;
                const selectedClass = coverage;
                return rowClass == selectedClass; // Use == for flexible comparison
            });
            // After coverage filter
        }
        
        // Final result processing complete
        
        return featureData;
    }

    getSpatialTabularDataForFeature(feature) {
        // Get the id_area from GeoJSON properties
        const idArea = feature.properties.id_area;
        if (!idArea) {
            return null;
        }
        
        // Get spatial-tabular mapping for this id_area
        const spatialData = this.spatialTabularMappings[idArea];
        if (!spatialData) {
            return null;
        }
        
        return spatialData;
    }

    createEnhancedPopupLegacy(feature, layer) {
        
        // Get CSV data for this feature (no map coverage filtering since the selector was removed)
        const csvData = this.getCSVDataForFeature(feature, null, null);
        
        // Get ALL data for this feature (unfiltered)
        const allTerritoryData = this.getCSVDataForFeature(feature, null, null);
        
        // Start building popup content
        let popupContent = '';
        
        // Create unique chart ID (available for entire function)
        const chartId = `popup-chart-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        
        // Add CSV data if available
        if (csvData && csvData.length > 0) {
            // Add CSV metadata section
            popupContent += '<div class="popup-section">';
            popupContent += '<div class="popup-section-title">📋 Información del Registro</div>';
            popupContent += this.createCSVMetadataSection(csvData);
            popupContent += '</div>';
            
            // Add temporal evolution chart section
            popupContent += '<div class="popup-section">';
            popupContent += `<div class="popup-section-title">📈 Evolución Temporal de Coberturas</div>`;
            
            // Add chart container
            popupContent += `<div class="popup-chart-container">`;
            popupContent += `<canvas id="${chartId}" width="400" height="250"></canvas>`;
            popupContent += `</div>`;
            
            // Total area summary (using all territory data)
            const totalArea = allTerritoryData.reduce((sum, row) => sum + (parseFloat(row.area) || 0), 0);
            const uniqueYears = [...new Set(allTerritoryData.map(d => d.year))].sort((a, b) => a - b);
            const yearRange = uniqueYears.length > 0 ? `${uniqueYears[0]} - ${uniqueYears[uniqueYears.length - 1]}` : '';
            
            popupContent += `<div class="total-area">`;
            popupContent += `Área total (${yearRange}): ${totalArea.toFixed(2)} km²`;
            popupContent += '</div>';
            popupContent += '</div>';
            
        } else {
            popupContent += '<div class="popup-section">';
            popupContent += '<div style="color: #666; font-style: italic;">';
            popupContent += 'No hay datos de cobertura disponibles para este territorio.';
            popupContent += '</div>';
            popupContent += '</div>';
        }
        
        // Set popup with enhanced content
        layer.bindPopup(popupContent, {
            maxWidth: 450, // Wider for chart
            className: 'enhanced-popup'
        });

        // Create chart after popup opens
        if (allTerritoryData && allTerritoryData.length > 0) {
            layer.on('popupopen', () => {
                // Wait for popup to be fully rendered
                setTimeout(() => {
                    this.createPopupTimeSeriesChart(chartId, allTerritoryData);
                }, 200);
            });

            // Cleanup chart when popup closes
            layer.on('popupclose', () => {
                const existingChart = this.popupCharts.get(chartId);
                if (existingChart) {
                    existingChart.destroy();
                    this.popupCharts.delete(chartId);
                }
            });
        }
    }

    createCSVMetadataSection(csvData) {
        let metadataHTML = '';
        
        if (csvData && csvData.length > 0) {
            const sampleData = csvData[0];
            
            if (sampleData.territory) {
                const territoryId = sampleData.territory;
                
                // Get the mappings for the current data source
                const currentSourceMappings = this.spatialTabularMappings[this.currentDataSource] || {};
                
                // Look up directly by territory ID (which should match id_gee in codes file)
                const spatialData = currentSourceMappings[territoryId];
                
                if (spatialData) {
                    // Get the current data source configuration
                    const currentSource = this.dataSources[this.currentDataSource];
                    
                    if (currentSource && currentSource.columns) {
                        // Show only the columns defined in the configuration
                        currentSource.columns.forEach(columnName => {
                            // Skip internal/technical fields and empty placeholders
                            if (columnName !== 'id_gee' && 
                                columnName !== 'id_area' && 
                                !columnName.startsWith('placeholder') && 
                                spatialData[columnName] && 
                                spatialData[columnName].trim() !== '') {
                                metadataHTML += `<div style="margin-bottom: 8px;">`;
                                metadataHTML += `<strong>${this.formatColumnName(columnName)}:</strong> ${spatialData[columnName]}`;
                                metadataHTML += `</div>`;
                            }
                        });
                    }
                } else {
                    // DEBUG: Log when spatial data is not found for MASCARA
                    if (this.currentDataSource === 'MASCARA') {
                    }
                    // Fallback: show territory name from territoryNames mapping
                    const territoryName = this.territoryNames[territoryId];
                    if (territoryName) {
                        metadataHTML += `<div style="margin-bottom: 8px;">`;
                        metadataHTML += `<strong>Territorio:</strong> ${territoryName}`;
                        metadataHTML += `</div>`;
                    } else {
                        metadataHTML += `<div style="margin-bottom: 8px;">`;
                        metadataHTML += `<strong>ID Territorio:</strong> ${territoryId}`;
                        metadataHTML += `</div>`;
                    }
                }
            }
        }
        
        return metadataHTML;
    }
    
    formatColumnName(columnName) {
        // Format column names for display
        const nameMap = {
            'id_gee': 'ID GEE',
            'id_area': 'ID Área',
            'departamento': 'Departamento',
            'municipio': 'Municipio',
            'resguardo': 'Resguardo',
            'territorio': 'Territorio',
            'nombre': 'Nombre',
            'codigo': 'Código',
            'ANP nal': 'ANP Nacional',
            'anp nal': 'ANP Nacional',
            'ANP depto': 'ANP Departamental',
            'anp nacional': 'ANP Nacional',
            'TI': 'Territorio Indígena'
        };
        
        return nameMap[columnName] || columnName.charAt(0).toUpperCase() + columnName.slice(1);
    }

    createScrollableTable(coverageEntries) {
        let tableHTML = `<table class="coverage-table">`;
        
        // Add sticky header
        tableHTML += `<thead>`;
        tableHTML += `<tr>`;
        tableHTML += `<th>Cobertura</th>`;
        tableHTML += `<th>Área (km²)</th>`;
        // tableHTML += `<th>Registros</th>`;
        tableHTML += `</tr>`;
        tableHTML += `</thead>`;
        
        tableHTML += `<tbody>`;
        
        // Add all data rows
        coverageEntries.forEach(([coverage, rows]) => {
            const coverageInfo = this.coverageNames[coverage];
            const coverageName = coverageInfo ? coverageInfo.name : `Clase ${coverage}`;
            const totalArea = rows.reduce((sum, row) => sum + (parseFloat(row.area) || 0), 0);
            
            tableHTML += `<tr>`;
            tableHTML += `<td class="coverage-name">${coverageName}</td>`;
            tableHTML += `<td class="coverage-area">${totalArea.toFixed(2)}</td>`;
            // tableHTML += `<td class="coverage-records">${rows.length}</td>`;
            tableHTML += `</tr>`;
        });
        
        tableHTML += `</tbody>`;
        tableHTML += `</table>`;
        
        return tableHTML;
    }

    updateMap() {
        // Refresh map layer popups when filters change, maintain consistent styling
        if (this.mapLayer) {
            try {
                // Standard consistent style for all layers
                const standardStyle = {
                    fillColor: '#3498db',
                    weight: 2,
                    opacity: 1,
                    color: '#2980b9',
                    fillOpacity: 0.6
                };
                
                // Apply consistent style and update popups
                this.mapLayer.eachLayer(layer => {
                    // Ensure all layers have the same style
                    layer.setStyle(standardStyle);
                    
                    // Update popup content with current filter data
                    if (layer.feature) {
                        this.createEnhancedPopupLegacy(layer.feature, layer);
                    }
                });
                
            } catch (error) {
                // Failed to update map enhancements
            }
        }
        
        // Update map legend
        this.updateMapLegend();
    }


    findTerritoryId(properties) {
        // Try to find territory ID in feature properties
        // This may need adjustment based on your GeoJSON structure
        const possibleKeys = ['id', 'ID', 'codigo', 'CODIGO', 'code', 'CODE', 'dpto', 'DPTO'];
        
        for (const key of possibleKeys) {
            if (properties[key] !== undefined) {
                return parseFloat(properties[key]);
            }
        }
        
        return null;
    }

    loadCorrespondingGisLayer() {
        // Load the GIS layer corresponding to the current data source
        // Load GeoJSON files for spatial visualization
        this.loadGIS();
    }

    convertIdAreaToTerritory(idArea) {
        // Convert GeoJSON id_area to CSV territory using codes mapping
        // This searches through the codes to find id_gee for the given id_area
        
        if (!this.currentDataSource || !this.spatialTabularMappings[this.currentDataSource]) {
            return null;
        }
        
        const currentSourceMappings = this.spatialTabularMappings[this.currentDataSource];
        if (Object.keys(currentSourceMappings).length === 0) {
            return null;
        }
        
        // Search through all mappings to find the one with matching id_area
        // For ANP_DEPTO: GeoJSON has id_area=1661, codes file has "128.0;1661;Las Mercedes"
        // So we need to match GeoJSON.id_area with codes.id_area (second field)
        for (const [id_gee, data] of Object.entries(currentSourceMappings)) {
            // Try exact match first
            if (data.id_area && data.id_area.toString() === idArea.toString()) {
                return id_gee;
            }
            
            // Try with numeric comparison (GeoJSON 1661 should match codes 1661.0)
            if (data.id_area && parseFloat(data.id_area) === parseFloat(idArea)) {
                return id_gee;
            }
        }
        return null;
    }


    toggleSidebar() {
        const sidebar = document.getElementById('controlsSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        
        if (sidebar && overlay) {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        }
    }

    closeSidebar() {
        const sidebar = document.getElementById('controlsSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        
        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        }
    }

    applySidebarFilters() {
        // Apply current filter settings and update all components
        this.applyFilters();
        this.updateCharts();
        this.updateTable();
        this.updateMetrics();
        this.updateMap();
    }

    /**
     * Create time series chart for popup
     * @param {string} chartId - Canvas element ID
     * @param {Array} csvData - Data for this specific territory
     */
    createPopupTimeSeriesChart(chartId, csvData) {
        const canvas = document.getElementById(chartId);
        if (!canvas) {
            return;
        }

        try {
            // Process data for time series - group by year and coverage
            const timeData = {};
            
            csvData.forEach(row => {
                const year = row.year;
                const coverage = row.class;
                const area = parseFloat(row.area) || 0;
                
                // Apply SELECTIVE dashboard filters to popup data
                // Popups show data for the specific territory clicked, so we apply limited filtering
                
                // 1. Apply year range filter (respects temporal selection)
                if (year < this.filters.yearMin || year > this.filters.yearMax) {
                    return;
                }
                
                // 2. Territory filter: NOT applied - user clicked on this specific territory
                
                // 3. Coverage filter from sidebar: NOT applied - popups show all coverages for the territory
                // This prevents double filtering that causes empty charts
                
                if (!timeData[coverage]) {
                    timeData[coverage] = {};
                }
                
                if (!timeData[coverage][year]) {
                    timeData[coverage][year] = 0;
                }
                
                timeData[coverage][year] += area;
            });

            // Check if we have any data after filtering
            if (Object.keys(timeData).length === 0) {
                canvas.parentElement.innerHTML = '<p style="color: #666; font-style: italic;">No hay datos disponibles para el rango de años seleccionado</p>';
                return;
            }

            // Get top 5 coverages by total area for this territory
            const coverageTotals = {};
            Object.keys(timeData).forEach(coverage => {
                coverageTotals[coverage] = Object.values(timeData[coverage]).reduce((a, b) => a + b, 0);
            });

            const topCoverages = Object.keys(coverageTotals)
                .sort((a, b) => coverageTotals[b] - coverageTotals[a])
                .slice(0, 5);

            // Check if we have valid coverages to display
            if (topCoverages.length === 0) {
                canvas.parentElement.innerHTML = '<p style="color: #666; font-style: italic;">No hay datos de cobertura disponibles</p>';
                return;
            }

            // Create datasets for chart
            const datasets = topCoverages.map((coverage, index) => {
                const data = Object.keys(timeData[coverage]).map(year => ({
                    x: parseInt(year),
                    y: timeData[coverage][year]
                }));

                const coverageInfo = this.coverageNames[coverage];
                const coverageName = coverageInfo ? coverageInfo.name : `Clase ${coverage}`;
                const color = coverageInfo && coverageInfo.color ? coverageInfo.color : this.getColor(index);
                
                return {
                    label: coverageName,
                    data: data,
                    borderColor: color,
                    backgroundColor: color, // Sin alpha/transparencia
                    fill: false,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5
                };
            });

            // Create Chart.js instance
            const chart = new Chart(canvas, {
                type: 'line',
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Evolución Temporal por Cobertura',
                            font: {
                                size: 14,
                                weight: 'bold'
                            }
                        },
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: {
                                font: {
                                    size: 11
                                },
                                boxWidth: 12,
                                padding: 10
                            }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            callbacks: {
                                label: (context) => {
                                    const value = context.parsed.y;
                                    return `${context.dataset.label}: ${value.toFixed(2)} km²`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: 'Año',
                                font: {
                                    size: 11
                                }
                            },
                            min: csvData.length > 0 ? Math.min(...csvData.map(d => d.year)) : this.filters.yearMin,
                            max: csvData.length > 0 ? Math.max(...csvData.map(d => d.year)) : this.filters.yearMax,
                            ticks: {
                                font: {
                                    size: 10
                                },
                                stepSize: 5,
                                callback: function(value) {
                                    return Math.round(value);
                                }
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Área (km²)',
                                font: {
                                    size: 11
                                }
                            },
                            ticks: {
                                font: {
                                    size: 10
                                },
                                callback: function(value) {
                                    if (value >= 1000) {
                                        return (value / 1000).toFixed(1) + 'K';
                                    }
                                    return value.toFixed(0);
                                }
                            }
                        }
                    },
                    interaction: {
                        mode: 'nearest',
                        axis: 'x',
                        intersect: false
                    }
                }
            });

            // Store chart reference for cleanup
            this.popupCharts.set(chartId, chart);

        } catch (error) {
            canvas.parentElement.innerHTML = '<p style="color: #666; font-style: italic;">Error generando gráfico</p>';
        }
    }


    displayGeoJSONInfo() {
        // GeoJSON info display removed - keep method for compatibility
    }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    new AmazonDashboard();
});