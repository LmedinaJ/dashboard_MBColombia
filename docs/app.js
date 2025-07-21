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
        
        // Configuration parameters
        this.config = {
            tableMaxHeight: 200, // 🔧 CONFIGURABLE: Max height in pixels for table scroll (also change in CSS)
            enableMapBounds: false, // 🔧 CONFIGURABLE: Whether to restrict map panning to loaded GIS layer bounds
            tableMaxRows: 20 // 🔧 CONFIGURABLE: Maximum number of rows to display in data exploration table
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
            const response = await fetch('./data_sources copy.json');
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
        
        select.innerHTML = '<option value="">Seleccionar fuente de datos...</option>';
        
        Object.keys(this.dataSources).forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${key} - ${this.dataSources[key].description}`;
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
            
            this.data = this.parseCSV(csvText);
            
            // Filter out territories that have 0 area for all years
            this.data = this.filterValidTerritories(this.data);
            
            // Load territory and coverage names if available
            await this.loadMappings(this.dataSources[sourceName]);
            
            // Load spatial-tabular mappings for advanced integration
            await this.loadSpatialTabularMappings(this.dataSources[sourceName]);
            
            this.updateFilters();
            this.applyFilters();
            this.updateCharts();
            this.updateTable();
            this.updateMetrics();
            this.updateMapControls();
            
            // Populate debug table
            this.populateDebugTable();
            
            // Auto-load corresponding GIS layer
            this.loadCorrespondingGisLayer();
            
        } catch (error) {
            this.showError(`Error cargando datos: ${error.message}`);
        }
        
        this.showLoading(false);
    }

    parseCSV(csvText) {
        const lines = csvText.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        
        return lines.slice(1).map(line => {
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
            
            return row;
        });
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
        // Get the id_area from shapefile properties
        const idArea = feature.properties.id_area;
        if (!idArea) {
            return false;
        }
        
        // Convert shapefile id_area to CSV territory using codes mapping
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
            
            // SIMPLE DEBUG: Only log if we have data
            if (Object.keys(mappingsForThisSource).length > 0) {
                console.log('Loaded mappings for', this.currentDataSource, '- First key:', Object.keys(mappingsForThisSource)[0]);
            } else {
                console.log('NO MAPPINGS loaded for', this.currentDataSource);
            }
            
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
        
        lines.forEach((line) => {
            try {
                // Parse format: "id_gee;id_area;data1;data2;..." (using id_gee as key)
                const dataValues = line.split(';');
                
                if (dataValues.length < columns.length) {
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
        // Update year range
        const years = this.data.map(d => d.year).filter(y => !isNaN(y));
        const minYear = Math.min(...years);
        const maxYear = Math.max(...years);
        
        const yearMinSlider = document.getElementById('yearMin');
        const yearMaxSlider = document.getElementById('yearMax');
        
        yearMinSlider.min = minYear;
        yearMinSlider.max = maxYear;
        yearMinSlider.value = minYear;
        
        yearMaxSlider.min = minYear;
        yearMaxSlider.max = maxYear;
        yearMaxSlider.value = maxYear;
        
        this.filters.yearMin = minYear;
        this.filters.yearMax = maxYear;
        
        this.updateRangeSlider();
        
        // Update territory filters
        this.updateTerritoryFilters();
        
        // Update coverage filters
        this.updateCoverageFilters();
    }

    updateTerritoryFilters() {
        const territories = [...new Set(this.data.map(d => d.territory))].filter(t => t !== undefined);
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
            checkbox.checked = true;
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
            
            this.filters.territories.add(territory);
        });
    }

    updateCoverageFilters() {
        const coverages = [...new Set(this.data.map(d => d.class))].filter(c => c !== undefined);
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
            checkbox.checked = true;
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
            
            this.filters.coverages.add(coverage);
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

    setupMap() {
        // Initialize Leaflet map
        this.map = L.map('mapContainer').setView([4.5709, -74.2973], 6); // Colombia center
        
        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);
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
                        text: 'Top 15 Territorios por Área Total',
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

        // Sort and take top 15
        const sortedTerritories = Object.entries(territoryData)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 15);

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

    updateTable() {
        const tbody = document.querySelector('#dataTable tbody');
        tbody.innerHTML = '';
        
        // Show first N rows based on configuration
        const displayData = this.filteredData.slice(0, this.config.tableMaxRows);
        
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
            
            // Debug first few rows (removed debug output)
            
            tr.innerHTML = `
                <td>${territoryName}</td>
                <td>${coverageName}</td>
                <td>${row.year}</td>
                <td>${area.toFixed(2)}</td>
            `;
            
            tbody.appendChild(tr);
        });
        
        // Update data count
        document.getElementById('dataCount').textContent = 
            `${this.filteredData.length} registros (mostrando ${Math.min(this.config.tableMaxRows, this.filteredData.length)})`;
    }

    updateMetrics() {
        if (this.filteredData.length === 0) {
            this.clearMetrics();
            return;
        }

        const years = this.filteredData.map(d => d.year);
        const minYear = Math.min(...years);
        const maxYear = Math.max(...years);

        // Calculate areas for specific classes
        const getAreaByYearClass = (year, classId) => {
            return this.filteredData
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
        document.getElementById('forestChange').textContent = this.formatChange(forestFinal - forestInitial);
        
        document.getElementById('pastureArea').textContent = this.formatArea(pastureFinal);
        document.getElementById('pastureChange').textContent = this.formatChange(pastureFinal - pastureInitial);
        
        document.getElementById('agricultureArea').textContent = this.formatArea(agricultureFinal);
        document.getElementById('agricultureChange').textContent = this.formatChange(agricultureFinal - agricultureInitial);
        
        // Territory count
        const totalTerritories = new Set(this.filteredData.map(d => d.territory)).size;
        const allTerritories = new Set(this.data.map(d => d.territory)).size;
        const territoryPercent = ((totalTerritories / allTerritories) * 100).toFixed(1);
        
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

    setupEventListeners() {
        // Helper function to safely add event listeners
        const safeAddEventListener = (elementId, event, handler) => {
            const element = document.getElementById(elementId);
            if (element) {
                element.addEventListener(event, handler);
            }
        };

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
        safeAddEventListener('yearMin', 'input', (e) => {
            this.filters.yearMin = parseInt(e.target.value);
            this.updateRangeSlider();
            this.applyFilters();
        });

        safeAddEventListener('yearMax', 'input', (e) => {
            this.filters.yearMax = parseInt(e.target.value);
            this.updateRangeSlider();
            this.applyFilters();
        });

        // Show tooltips on hover - only in full dashboard
        safeAddEventListener('yearMin', 'mouseenter', () => {
            const tooltip = document.getElementById('tooltipMin');
            if (tooltip) tooltip.classList.add('show');
        });

        safeAddEventListener('yearMin', 'mouseleave', () => {
            const tooltip = document.getElementById('tooltipMin');
            if (tooltip) tooltip.classList.remove('show');
        });

        safeAddEventListener('yearMax', 'mouseenter', () => {
            const tooltip = document.getElementById('tooltipMax');
            if (tooltip) tooltip.classList.add('show');
        });

        safeAddEventListener('yearMax', 'mouseleave', () => {
            const tooltip = document.getElementById('tooltipMax');
            if (tooltip) tooltip.classList.remove('show');
        });

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

        // Debug table controls
        safeAddEventListener('refreshDebugTable', 'click', () => {
            this.populateDebugTable();
        });

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
        const minSlider = document.getElementById('yearMin');
        const maxSlider = document.getElementById('yearMax');
        
        // Update slider values
        minSlider.value = yearMin;
        maxSlider.value = yearMax;
        
        // Update tooltips
        document.getElementById('tooltipMin').textContent = yearMin;
        document.getElementById('tooltipMax').textContent = yearMax;
        
        // Calculate positions for tooltips and progress bar
        const minRange = parseInt(minSlider.min);
        const maxRange = parseInt(minSlider.max);
        const totalRange = maxRange - minRange;
        
        const minPercent = ((yearMin - minRange) / totalRange) * 100;
        const maxPercent = ((yearMax - minRange) / totalRange) * 100;
        
        // Update tooltip positions
        document.getElementById('tooltipMin').style.left = `${minPercent}%`;
        document.getElementById('tooltipMax').style.left = `${maxPercent}%`;
        
        // Update progress bar
        const progressBar = document.getElementById('rangeProgress');
        progressBar.style.left = `${minPercent}%`;
        progressBar.style.width = `${maxPercent - minPercent}%`;
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

    updateMapLegend() {
        const legendContainer = document.getElementById('legendItems');
        if (!legendContainer) return;
        
        legendContainer.innerHTML = '';

        // Get unique coverages for legend
        const coverages = [...new Set(this.data.map(d => d.class))].sort((a, b) => a - b);
        
        // Group coverages by hierarchy levels
        const hierarchicalGroups = this.groupCoveragesByHierarchy(coverages);
        
        // Create hierarchical legend
        this.createHierarchicalLegend(hierarchicalGroups, legendContainer);
    }

    groupCoveragesByHierarchy(coverages) {
        const groups = {};
        
        // First pass: collect all coverage info
        const allCoverageInfo = {};
        console.log('📊 Available coverages in data:', coverages);
        
        coverages.forEach(coverage => {
            const coverageInfo = this.coverageNames[coverage];
            if (coverageInfo) {
                const coverageName = coverageInfo.fullName || coverageInfo.name;
                console.log(`📝 Coverage ${coverage}: fullName="${coverageInfo.fullName}", name="${coverageInfo.name}"`);
                allCoverageInfo[coverage] = {
                    ...coverageInfo,
                    fullName: coverageName
                };
            }
        });
        
        // Second pass: process hierarchy
        coverages.forEach(coverage => {
            const coverageInfo = allCoverageInfo[coverage];
            if (!coverageInfo) return;
            
            const coverageName = coverageInfo.fullName;
            
            // Parse hierarchy from name (e.g., "1. Bosque", "1.1. Formación forestal")
            const hierarchyMatch = coverageName.match(/^(\d+)(\.\d+)?\.\s*(.+)/);
            
            if (hierarchyMatch) {
                const [, mainLevel, subLevel, name] = hierarchyMatch;
                const isSubLevel = !!subLevel;
                
                // DEBUG: Log parsing results
                console.log(`🔍 Parsing: "${coverageName}" → mainLevel: ${mainLevel}, subLevel: ${subLevel || 'none'}, name: "${name}", isSubLevel: ${isSubLevel}`);
                
                if (!isSubLevel) {
                    // Main level (e.g., "1. Bosque")
                    if (!groups[mainLevel]) {
                        groups[mainLevel] = {
                            name: name,
                            color: coverageInfo.color,
                            id: coverage,
                            subItems: []
                        };
                    }
                } else {
                    // Sub level (e.g., "1.1. Formación forestal")
                    if (!groups[mainLevel]) {
                        // Find the main level name by looking for the base class (e.g., "1. Bosque")
                        const mainLevelName = this.findMainLevelName(mainLevel);
                        
                        groups[mainLevel] = {
                            name: mainLevelName || `Nivel ${mainLevel}`,
                            color: this.getColor(parseInt(mainLevel) % 10),
                            id: null,
                            subItems: []
                        };
                    }
                    
                    groups[mainLevel].subItems.push({
                        name: name,
                        color: coverageInfo.color,
                        id: coverage
                    });
                }
            } else {
                // Fallback for items without hierarchy
                console.log(`⚠️ No hierarchy match for: "${coverageName}" → going to "Otras Coberturas"`);
                
                const fallbackGroup = 'otros';
                if (!groups[fallbackGroup]) {
                    groups[fallbackGroup] = {
                        name: 'Otras Coberturas',
                        color: '#cccccc',
                        id: null,
                        subItems: []
                    };
                }
                
                groups[fallbackGroup].subItems.push({
                    name: coverageName,
                    color: coverageInfo.color,
                    id: coverage
                });
            }
        });
        
        return groups;
    }

    findMainLevelName(mainLevel) {
        // Look for the main level class (e.g., "1. Bosque" for mainLevel "1")
        // Search in ALL coverageNames (palette), not just current data
        console.log(`🔍 Looking for main level ${mainLevel} in complete palette...`);
        
        // Search through the complete palette (this.coverageNames)
        for (const [coverageId, coverageInfo] of Object.entries(this.coverageNames)) {
            if (coverageInfo && coverageInfo.fullName) {
                const fullName = coverageInfo.fullName;
                
                // Simple regex: number + period + optional space + name
                const match = fullName.match(/^(\d+)\.\s*(.+)$/);
                
                if (match) {
                    const matchedLevel = match[1];
                    const namesPart = match[2];
                    
                    if (matchedLevel === mainLevel) {
                        // Check if this is a main level (name shouldn't start with another number+period)
                        if (!namesPart.match(/^\d+\./)) {
                            // Return the full name with number (e.g., "1. Bosque")
                            const fullMainName = `${matchedLevel}. ${namesPart}`;
                            console.log(`🎯 FOUND main level for ${mainLevel}: "${fullMainName}" (from coverage ID ${coverageId})`);
                            return fullMainName;
                        }
                    }
                }
            }
        }
        
        console.log(`⚠️ No main level found for ${mainLevel} in palette, using fallback`);
        return null;
    }

    createHierarchicalLegend(groups, container) {
        // Sort groups by main level number
        const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
            if (a === 'otros') return 1;
            if (b === 'otros') return -1;
            return parseInt(a) - parseInt(b);
        });
        
        sortedGroupKeys.forEach(groupKey => {
            const group = groups[groupKey];
            
            // Create main group container
            const groupContainer = document.createElement('div');
            groupContainer.className = 'legend-group';
            
            // Create main level item (if it has an ID, meaning it exists in data)
            if (group.id) {
                const mainItem = document.createElement('div');
                mainItem.className = 'legend-item legend-main';
                
                // If there are subitems, make it a dropdown
                if (group.subItems.length > 0) {
                    mainItem.className += ' legend-dropdown';
                    mainItem.innerHTML = `
                        <div class="legend-dropdown-header">
                            <div class="legend-color" style="background-color: ${group.color}"></div>
                            <div class="legend-text">${group.name}</div>
                            <div class="legend-arrow">▼</div>
                        </div>
                    `;
                    
                    // Add click event listener to the header
                    const header = mainItem.querySelector('.legend-dropdown-header');
                    header.addEventListener('click', function(e) {
                        e.stopPropagation();
                        mainItem.classList.toggle('expanded');
                    });
                    
                    // Create sub-level items container inside the dropdown
                    const subItemsContainer = document.createElement('div');
                    subItemsContainer.className = 'legend-subitems';
                    
                    group.subItems.forEach(subItem => {
                        const subItemElement = document.createElement('div');
                        subItemElement.className = 'legend-item legend-sub';
                        subItemElement.innerHTML = `
                            <div class="legend-color" style="background-color: ${subItem.color}"></div>
                            <div class="legend-text">${subItem.name}</div>
                        `;
                        subItemsContainer.appendChild(subItemElement);
                    });
                    
                    mainItem.appendChild(subItemsContainer);
                } else {
                    // No subitems, regular item
                    mainItem.innerHTML = `
                        <div class="legend-color" style="background-color: ${group.color}"></div>
                        <div class="legend-text">${group.name}</div>
                    `;
                }
                groupContainer.appendChild(mainItem);
            } else if (group.subItems.length > 0) {
                // Create group header for items that only have subitems
                const groupHeader = document.createElement('div');
                groupHeader.className = 'legend-group-header legend-dropdown';
                groupHeader.innerHTML = `
                    <div class="legend-dropdown-header">
                        <div class="legend-text">${group.name}</div>
                        <div class="legend-arrow">▼</div>
                    </div>
                `;
                
                // Add click event listener to the header
                const header = groupHeader.querySelector('.legend-dropdown-header');
                header.addEventListener('click', function(e) {
                    e.stopPropagation();
                    groupHeader.classList.toggle('expanded');
                });
                
                // Create sub-level items container inside the dropdown
                const subItemsContainer = document.createElement('div');
                subItemsContainer.className = 'legend-subitems';
                
                group.subItems.forEach(subItem => {
                    const subItemElement = document.createElement('div');
                    subItemElement.className = 'legend-item legend-sub';
                    subItemElement.innerHTML = `
                        <div class="legend-color" style="background-color: ${subItem.color}"></div>
                        <div class="legend-text">${subItem.name}</div>
                    `;
                    subItemsContainer.appendChild(subItemElement);
                });
                
                groupHeader.appendChild(subItemsContainer);
                groupContainer.appendChild(groupHeader);
            }
            
            // Only add group if it has content
            if (group.id || group.subItems.length > 0) {
                container.appendChild(groupContainer);
            }
        });
    }

    async loadShapefile() {
        if (!this.currentDataSource || !this.dataSources[this.currentDataSource].gis) {
            return;
        }
        
        const geojsonPath = this.dataSources[this.currentDataSource].gis;
        
        try {
            // Remove existing layer if any
            if (this.mapLayer) {
                this.map.removeLayer(this.mapLayer);
            }
            
            console.log(`Loading GeoJSON: ${geojsonPath}`);
            
            // Load GeoJSON directly (much simpler than shapefiles!)
            await this.loadGeoJSON(geojsonPath);
            
        } catch (error) {
            console.warn('GeoJSON loading failed, continuing without map:', error);
            this.createDataVisualization();
        }
    }

    async loadGeoJSON(geojsonPath) {
        try {
            console.log(`Fetching GeoJSON from: ${geojsonPath}`);
            
            let response;
            
            // Try different approaches based on environment
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                // Local development - try local file first
                response = await fetch(`./${geojsonPath}`);
            } else {
                // GitHub Pages - use GitHub Releases for large files
                const githubRepo = 'LmedinaJ/dashboard_MBColombia';
                const releaseTag = 'v1.0.0-geojson';
                const fileName = geojsonPath.split('/').pop(); // Extract filename from path
                const releaseUrl = `https://github.com/${githubRepo}/releases/download/${releaseTag}/${fileName}`;
                
                console.log(`Trying GitHub Release URL: ${releaseUrl}`);
                
                try {
                    response = await fetch(releaseUrl);
                    if (!response.ok) {
                        throw new Error(`Release file not found: ${response.status}`);
                    }
                } catch (error) {
                    console.warn('GitHub Release failed, trying local path:', error);
                    response = await fetch(`./${geojsonPath}`);
                }
            }
            if (!response.ok) {
                throw new Error(`Failed to load GeoJSON: ${response.status} ${response.statusText}`);
            }
            
            const geojsonData = await response.json();
            console.log(`GeoJSON loaded: ${geojsonData.features.length} features`);
            
            // Create Leaflet GeoJSON layer
            this.mapLayer = L.geoJSON(geojsonData, {
                style: {
                    fillColor: '#3388ff',
                    weight: 2,
                    opacity: 1,
                    color: 'white',
                    dashArray: '3',
                    fillOpacity: 0.7
                },
                onEachFeature: (feature, layer) => {
                    // Add popup functionality
                    this.createEnhancedPopup(feature, layer);
                }
            });
            
            // Add layer to map
            if (this.mapLayer) {
                this.mapLayer.addTo(this.map);
                
                // Fit map to show all features
                if (this.mapLayer.getLayers && this.mapLayer.getLayers().length > 0) {
                    if (typeof this.mapLayer.getBounds === 'function') {
                        this.map.fitBounds(this.mapLayer.getBounds());
                    }
                }
                
                // Process the data for visualization
                this.processGeoJSON(geojsonData);
            }
            
        } catch (error) {
            console.error('Error loading GeoJSON:', error);
            throw error;
        }
    }

    async loadWithLeafletShapefile(shapefilePath) {
        
        return new Promise((resolve, reject) => {
            const shapefileLayer = new L.shapefile(shapefilePath, {
                onEachFeature: (feature, layer) => {
                    // Add popup with feature properties
                    if (feature.properties) {
                        const popupContent = Object.entries(feature.properties)
                            .map(([key, value]) => `<strong>${key}:</strong> ${value}`)
                            .join('<br>');
                        layer.bindPopup(popupContent);
                    }
                }
            });
            
            shapefileLayer.on('data:loaded', () => {
                this.mapLayer = shapefileLayer;
                this.mapLayer.addTo(this.map);
                this.map.fitBounds(this.mapLayer.getBounds());
                this.updateMap();
                resolve();
            });
            
            shapefileLayer.on('data:error', (error) => {
                reject(error);
            });
        });
    }

    async loadZipShapefile(zipPath) {
        const response = await fetch(zipPath);
        if (!response.ok) {
            throw new Error(`Failed to load shapefile ZIP: ${response.status}`);
        }
        
        const zipBuffer = await response.arrayBuffer();
        
        // Use streaming approach for better compatibility
        
        try {
            const source = await shapefile.open(zipBuffer);
            const features = [];
            
            // Read all features
            while (true) {
                const result = await source.read();
                if (result.done) break;
                
                if (result.value && result.value.geometry) {
                    // Validate geometry
                    if (this.isValidGeometry(result.value.geometry)) {
                        features.push(result.value);
                    }
                }
            }
            
            if (features.length === 0) {
                throw new Error('No valid features found in shapefile');
            }
            
            const geojson = {
                type: 'FeatureCollection',
                features: features
            };
            
            this.processGeoJSON(geojson);
            
        } catch (error) {
            throw error;
        }
    }

    async loadComponentShapefile(basePath) {
        const shpUrl = `${basePath}.shp`;
        const dbfUrl = `${basePath}.dbf`;
        
        // Check if shapefile library is available
        if (!window.shapefile) {
            throw new Error('Shapefile library not available');
        }
        
        try {
            const [shpResponse, dbfResponse] = await Promise.all([
                fetch(shpUrl),
                fetch(dbfUrl)
            ]);
            
            if (!shpResponse.ok) {
                throw new Error(`Failed to load .shp file: ${shpResponse.status} - ${shpUrl}`);
            }
            if (!dbfResponse.ok) {
                throw new Error(`Failed to load .dbf file: ${dbfResponse.status} - ${dbfUrl}`);
            }
            
            const [shpBuffer, dbfBuffer] = await Promise.all([
                shpResponse.arrayBuffer(),
                dbfResponse.arrayBuffer()
            ]);
            
            // Files loaded successfully
            
            // Try direct reading first (faster)
            try {
                const geojson = await shapefile.read(shpBuffer, dbfBuffer);
                this.processGeoJSON(geojson);
                return;
            } catch (directError) {
            }
            
            // Fallback to streaming approach
            const source = await shapefile.open(shpBuffer, dbfBuffer);
            const features = [];
            
            let featureCount = 0;
            while (true) {
                const result = await source.read();
                if (result.done) break;
                
                featureCount++;
                if (result.value && result.value.geometry) {
                    // Validate geometry
                    if (this.isValidGeometry(result.value.geometry)) {
                        features.push(result.value);
                    }
                }
            }
            
            if (features.length === 0) {
                throw new Error('No valid features found in shapefile');
            }
            
            const geojson = {
                type: 'FeatureCollection',
                features: features
            };
            
            this.processGeoJSON(geojson);
            
        } catch (error) {
            throw error;
        }
    }

    isValidGeometry(geometry) {
        if (!geometry || !geometry.type) {
            return false;
        }
        
        const validTypes = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
        if (!validTypes.includes(geometry.type)) {
            return false;
        }
        
        // Check if coordinates exist and are not empty
        if (!geometry.coordinates || geometry.coordinates.length === 0) {
            return false;
        }
        
        return true;
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
            
            // Standard consistent style for all shapefiles
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
                    this.createEnhancedPopup(feature, layer);
                }
            }).addTo(this.map);
            
            // Get the bounds of the loaded layer
            const layerBounds = this.mapLayer.getBounds();
            
            // Fit map to shapefile bounds
            this.map.fitBounds(layerBounds);
            
            // Conditionally restrict map view to the bounds of the loaded GIS layer
            if (this.config.enableMapBounds) {
                // Add some padding to the bounds for better UX
                const paddedBounds = layerBounds.pad(0.1); // 10% padding
                this.map.setMaxBounds(paddedBounds);
                
                // Set reasonable zoom limits
                this.map.setMinZoom(this.map.getZoom() - 2); // Allow zooming out a bit
            }
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
                this.createEnhancedPopup(feature, layer);
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
        // Get the id_area from shapefile properties
        const idArea = feature.properties.id_area;
        if (!idArea) {
            return [];
        }
        
        // Convert shapefile id_area to CSV territory using codes mapping
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
        // Get the id_area from shapefile properties
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

    createEnhancedPopup(feature, layer) {
        // Get CSV data for this feature (no map coverage filtering since the selector was removed)
        const csvData = this.getCSVDataForFeature(feature, null, null);
        
        // Get ALL data for this feature (unfiltered)
        const allTerritoryData = this.getCSVDataForFeature(feature, null, null);
        
        // Start building popup content
        let popupContent = '';
        
        // Create unique chart ID (available for entire function)
        const chartId = `popup-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
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
            popupContent += `No hay datos de cobertura disponibles${selectedCoverage ? ` para la cobertura seleccionada` : ''}.`;
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
                        console.log(`🔍 MASCARA DEBUG - No spatial data found for territory: ${territoryId}`);
                        console.log('Available mappings:', Object.keys(this.spatialTabularMappings.MASCARA || {}));
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
                        this.createEnhancedPopup(layer.feature, layer);
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
        // This may need adjustment based on your shapefile structure
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
        // The loadShapefile function now loads GeoJSON files instead of shapefiles
        this.loadShapefile();
    }

    convertIdAreaToTerritory(idArea) {
        // Convert shapefile id_area to CSV territory using codes mapping
        // This searches through the codes to find id_gee for the given id_area
        
        if (!this.currentDataSource || !this.spatialTabularMappings[this.currentDataSource]) {
            return null;
        }
        
        const currentSourceMappings = this.spatialTabularMappings[this.currentDataSource];
        
        // Search through all mappings to find the one with matching id_area
        for (const [id_gee, data] of Object.entries(currentSourceMappings)) {
            if (data.id_area && data.id_area.toString() === idArea.toString()) {
                // Found match! Return the id_gee (which is what CSV uses as territory)
                return id_gee;
            }
        }
        
        return null;
    }

    populateDebugTable() {
        const debugTableHeader = document.getElementById('debugTableHeader');
        const debugTableBody = document.getElementById('debugTableBody');
        const debugTableStatus = document.getElementById('debugTableStatus');
        
        if (!debugTableHeader || !debugTableBody || !debugTableStatus) {
            return;
        }

        // Update status
        debugTableStatus.textContent = 'Generando tabla...';
        
        // Clear existing content
        debugTableHeader.innerHTML = '';
        debugTableBody.innerHTML = '';

        if (!this.currentDataSource || !this.data || this.data.length === 0) {
            debugTableStatus.textContent = 'No hay datos disponibles';
            return;
        }

        // Get unique territory IDs from filtered CSV data (only territories with area > 0)
        const uniqueTerritories = [...new Set(this.data.map(row => row.territory))].sort((a, b) => a - b).slice(0, 25); // Show more after filtering
        
        // Calculate some statistics
        const totalValidTerritories = uniqueTerritories.length;
        const totalRecords = this.data.length;
        
        // Get current source mappings
        const currentSourceMappings = this.spatialTabularMappings[this.currentDataSource] || {};
        const currentSource = this.dataSources[this.currentDataSource];
        
        // Create headers for CSV-Codes merge
        const headers = ['CSV Territory', 'Codes id_gee', 'Match Status', 'CSV Records'];
        if (currentSource && currentSource.columns) {
            currentSource.columns.forEach(col => {
                if (col !== 'id_gee' && col !== 'id_area' && !col.startsWith('placeholder')) {
                    headers.push(`Codes: ${col}`);
                }
            });
        }
        
        headers.forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            debugTableHeader.appendChild(th);
        });

        // Populate rows showing CSV-Codes merge
        uniqueTerritories.forEach(csvTerritory => {
            const row = document.createElement('tr');
            
            // CSV Territory column
            const csvTerritoryCell = document.createElement('td');
            csvTerritoryCell.textContent = csvTerritory;
            csvTerritoryCell.className = 'territory-id';
            row.appendChild(csvTerritoryCell);
            
            // Codes id_gee column (should match CSV territory)
            const idGeeCell = document.createElement('td');
            const spatialData = currentSourceMappings[csvTerritory];
            if (spatialData && spatialData.id_gee) {
                idGeeCell.textContent = spatialData.id_gee;
                idGeeCell.className = 'merged-data';
            } else {
                idGeeCell.textContent = '-';
                idGeeCell.className = 'no-data';
            }
            row.appendChild(idGeeCell);
            
            // Match status: CSV.territory === Codes.id_gee
            const matchCell = document.createElement('td');
            if (spatialData && spatialData.id_gee && spatialData.id_gee.toString() === csvTerritory.toString()) {
                matchCell.textContent = '✅ MATCH';
                matchCell.className = 'merged-data';
            } else if (spatialData) {
                matchCell.textContent = '⚠️ MISMATCH';
                matchCell.className = 'no-data';
            } else {
                matchCell.textContent = '❌ NO FOUND';
                matchCell.className = 'no-data';
            }
            row.appendChild(matchCell);
            
            // CSV Records count
            const csvRecordsCell = document.createElement('td');
            const csvRecords = this.data.filter(d => d.territory === csvTerritory);
            csvRecordsCell.textContent = csvRecords.length;
            row.appendChild(csvRecordsCell);
            
            // Additional columns from codes
            if (currentSource && currentSource.columns) {
                currentSource.columns.forEach(col => {
                    if (col !== 'id_gee' && col !== 'id_area' && !col.startsWith('placeholder')) {
                        const dataCell = document.createElement('td');
                        if (spatialData && spatialData[col]) {
                            dataCell.textContent = spatialData[col];
                            dataCell.className = 'merged-data';
                        } else {
                            dataCell.textContent = '-';
                            dataCell.className = 'no-data';
                        }
                        row.appendChild(dataCell);
                    }
                });
            }
            
            debugTableBody.appendChild(row);
        });

        // Update status with detailed statistics
        const totalMapped = uniqueTerritories.filter(id => currentSourceMappings[id]).length;
        debugTableStatus.textContent = `${totalMapped}/${totalValidTerritories} territorios válidos con codes merged | ${totalRecords} registros filtrados | Mostrando primeros 25`;
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
            console.warn(`Canvas ${chartId} not found for popup chart`);
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
            console.error('Error creating popup chart:', error);
            canvas.parentElement.innerHTML = '<p style="color: #666; font-style: italic;">Error generando gráfico</p>';
        }
    }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    new AmazonDashboard();
});