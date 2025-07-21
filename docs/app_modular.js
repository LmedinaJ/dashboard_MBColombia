/**
 * Amazon Dashboard - Application Entry Point (Modular Version)
 * Main application entry point using ES6 modules
 */
import { AmazonDashboard } from './js/core/AmazonDashboard.js';
import { config } from './js/core/Config.js';

// Global dashboard instance
let dashboard = null;

/**
 * Initialize the dashboard application
 */
async function initializeDashboard() {
    try {
        console.log('🚀 Starting Amazon Dashboard v2.0 (Modular Architecture)');
        console.log('📊 Dashboard Info:', AmazonDashboard.getInfo());
        
        // Create dashboard instance
        dashboard = new AmazonDashboard();
        
        // Initialize dashboard
        await dashboard.init();
        
        // Make dashboard globally accessible for debugging
        if (config.get('dev.enableLogging')) {
            window.dashboard = dashboard;
            window.dashboardStats = () => dashboard.getApplicationStats();
            console.log('🔧 Dashboard instance available globally as window.dashboard');
            console.log('📊 Dashboard stats available as window.dashboardStats()');
        }
        
        console.log('✅ Amazon Dashboard v2.0 ready!');
        
    } catch (error) {
        console.error('❌ Failed to initialize dashboard:', error);
        
        // Show error to user
        const errorContainer = document.createElement('div');
        errorContainer.className = 'initialization-error';
        errorContainer.innerHTML = `
            <div class="error-content">
                <h2>⚠️ Error de Inicialización</h2>
                <p>No se pudo cargar el dashboard:</p>
                <code>${error.message}</code>
                <button onclick="location.reload()" class="retry-btn">🔄 Reintentar</button>
            </div>
        `;
        
        document.body.appendChild(errorContainer);
    }
}

/**
 * Handle page load
 */
function handlePageLoad() {
    // Check for required browser features
    if (!window.fetch || !window.Promise || !window.Map || !window.Set) {
        console.error('❌ Browser not supported. Please use a modern browser.');
        showBrowserNotSupportedMessage();
        return;
    }
    
    // Check for required libraries
    const requiredLibraries = ['Chart', 'L']; // Chart.js and Leaflet
    const missingLibraries = requiredLibraries.filter(lib => typeof window[lib] === 'undefined');
    
    if (missingLibraries.length > 0) {
        console.error('❌ Missing required libraries:', missingLibraries);
        showMissingLibrariesMessage(missingLibraries);
        return;
    }
    
    // Initialize dashboard
    initializeDashboard();
}

/**
 * Show browser not supported message
 */
function showBrowserNotSupportedMessage() {
    document.body.innerHTML = `
        <div class="browser-error">
            <h2>🚫 Navegador No Compatible</h2>
            <p>Este dashboard requiere un navegador moderno que soporte ES6 modules.</p>
            <p>Por favor actualice su navegador o use:</p>
            <ul>
                <li>Chrome 61+ / Edge 16+ / Firefox 60+ / Safari 11+</li>
            </ul>
        </div>
    `;
}

/**
 * Show missing libraries message
 * @param {Array} missingLibs - Array of missing library names
 */
function showMissingLibrariesMessage(missingLibs) {
    document.body.innerHTML = `
        <div class="library-error">
            <h2>📚 Bibliotecas Faltantes</h2>
            <p>Las siguientes bibliotecas requeridas no están disponibles:</p>
            <ul>
                ${missingLibs.map(lib => `<li>${lib}</li>`).join('')}
            </ul>
            <button onclick="location.reload()" class="retry-btn">🔄 Reintentar</button>
        </div>
    `;
}

/**
 * Handle page visibility changes (for performance optimization)
 */
function handleVisibilityChange() {
    if (dashboard && dashboard.isInitialized) {
        if (document.hidden) {
            // Page is hidden, pause heavy operations
            console.log('📱 Page hidden, pausing operations');
        } else {
            // Page is visible, resume operations
            console.log('📱 Page visible, resuming operations');
            
            // Refresh charts if needed
            if (dashboard.chartManager && dashboard.chartManager.isChartsInitialized()) {
                dashboard.chartManager.resizeCharts();
            }
            
            // Refresh map if needed
            if (dashboard.mapManager && dashboard.mapManager.isMapInitialized()) {
                setTimeout(() => {
                    dashboard.mapManager.getMap()?.invalidateSize();
                }, 100);
            }
        }
    }
}

/**
 * Handle before page unload (cleanup)
 */
function handleBeforeUnload() {
    if (dashboard) {
        console.log('🧹 Cleaning up dashboard before page unload');
        dashboard.destroy();
    }
}

/**
 * Setup global error handling
 */
function setupErrorHandling() {
    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
        console.error('🚨 Unhandled promise rejection:', event.reason);
        
        if (dashboard) {
            dashboard.showError(`Error inesperado: ${event.reason.message || event.reason}`);
        }
        
        // Prevent default browser error handling
        event.preventDefault();
    });
    
    // Handle general errors
    window.addEventListener('error', (event) => {
        console.error('🚨 Global error:', event.error);
        
        if (dashboard) {
            dashboard.showError(`Error de aplicación: ${event.error.message || 'Error desconocido'}`);
        }
    });
}

/**
 * Setup performance monitoring (if enabled)
 */
function setupPerformanceMonitoring() {
    if (config.get('dev.enablePerformanceMetrics') && 'performance' in window) {
        // Monitor page load performance
        window.addEventListener('load', () => {
            setTimeout(() => {
                const perfData = performance.getEntriesByType('navigation')[0];
                if (perfData) {
                    console.log('⚡ Performance Metrics:', {
                        pageLoad: Math.round(perfData.loadEventEnd - perfData.navigationStart),
                        domContentLoaded: Math.round(perfData.domContentLoadedEventEnd - perfData.navigationStart),
                        firstPaint: Math.round(performance.getEntriesByType('paint')[0]?.startTime || 0)
                    });
                }
            }, 0);
        });
    }
}

/**
 * Initialize application when DOM is ready
 */
function init() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handlePageLoad);
    } else {
        handlePageLoad();
    }
    
    // Setup event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Setup error handling
    setupErrorHandling();
    
    // Setup performance monitoring
    setupPerformanceMonitoring();
}

// Start the application
init();

// Export for debugging
export { dashboard, initializeDashboard };