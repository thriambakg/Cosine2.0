/**
 * TileDataParser - A comprehensive data extraction system for all tile types
 * 
 * This class extracts and formats data from tiles into a clean JSON structure
 * that can be consumed by AI analysis systems. It processes all tile content
 * including charts, images, numbers, and metadata.
 */

export interface ExtractedTileData {
  uuid: string;
  type: 'crypto' | 'stock' | 'placeholder' | 'portfolio' | 'custom' | 'chat_generated';
  data: {
    // Basic tile information
    title: string;
    symbol?: string;
    timeframe?: string;
    
    // Financial data
    currentPrice?: number;
    priceChange?: number;
    priceChangePercent?: number;
    annualReturn?: number;
    volatility?: number;
    volume?: number;
    marketCap?: number;
    
    // Chart data
    chartData?: Array<{
      time: number | string;
      price: number;
      volume?: number;
      date?: string;
      timeLabel?: string;
    }>;
    
    // Display options
    displayOptions?: {
      showPrice: boolean;
      showPriceMarker: boolean;
      show24hChange: boolean;
      showAnnualReturn: boolean;
      showVolatility: boolean;
      showChart: boolean;
    };
    
    // Tile configuration
    autoRefresh?: boolean;
    isPinned?: boolean;
    size?: { width: number; height: number };
    gridPosition?: { x: number; y: number };
    gridSize?: { width: number; height: number };
    
    // Status information
    isLoading?: boolean;
    hasError?: boolean;
    lastUpdated?: string;
    
    // Raw API data (for debugging and advanced analysis)
    rawApiData?: any;
  };
}

export class TileDataParser {
  /**
   * Extract data from a single tile
   */
  static extractTileData(tile: any): ExtractedTileData {
    const baseData: ExtractedTileData = {
      uuid: tile.id,
      type: tile.type as ExtractedTileData['type'],
      data: {
        title: tile.title || tile.symbol || `Tile ${tile.id}`,
        size: tile.size,
        gridPosition: tile.gridPosition,
        gridSize: tile.gridSize,
        lastUpdated: new Date().toISOString(),
      }
    };

    // Extract type-specific data
    switch (tile.type) {
      case 'crypto':
        return this.extractCryptoData(tile, baseData);
      case 'stock':
        return this.extractStockData(tile, baseData);
      case 'placeholder':
        return this.extractPlaceholderData(tile, baseData);
      default:
        return baseData;
    }
  }

  /**
   * Extract data from tile configuration (when API data is not available)
   */
  static extractTileConfigData(tile: any): ExtractedTileData {
    const baseData: ExtractedTileData = {
      uuid: tile.id,
      type: tile.type as ExtractedTileData['type'],
      data: {
        title: tile.title || tile.symbol || `Tile ${tile.id}`,
        symbol: tile.symbol,
        timeframe: tile.timeframe,
        size: tile.size,
        gridPosition: tile.gridPosition,
        gridSize: tile.gridSize,
        displayOptions: tile.displayOptions,
        autoRefresh: tile.autoRefresh,
        isPinned: tile.isPinned,
        lastUpdated: new Date().toISOString(),
        // Mark as configuration data only
        hasError: false,
        isLoading: false,
      }
    };

    return baseData;
  }

  /**
   * Extract data from multiple tiles
   */
  static extractMultipleTiles(tiles: any[]): Record<string, ExtractedTileData> {
    const result: Record<string, ExtractedTileData> = {};
    
    tiles.forEach(tile => {
      try {
        result[tile.id] = this.extractTileData(tile);
      } catch (error) {
        console.error(`Error extracting data from tile ${tile.id}:`, error);
        // Create a fallback entry for failed extractions
        result[tile.id] = {
          uuid: tile.id,
          type: tile.type as ExtractedTileData['type'],
          data: {
            title: tile.title || tile.symbol || `Tile ${tile.id}`,
            hasError: true,
            lastUpdated: new Date().toISOString(),
          }
        };
      }
    });

    return result;
  }

  /**
   * Extract crypto-specific data
   */
  private static extractCryptoData(tile: any, baseData: ExtractedTileData): ExtractedTileData {
    const cryptoData = tile.cryptoData || tile.data?.data?.find((c: any) => c.symbol === tile.symbol);
    
    if (!cryptoData) {
      return {
        ...baseData,
        data: {
          ...baseData.data,
          symbol: tile.symbol,
          timeframe: tile.timeframe,
          displayOptions: tile.displayOptions,
          autoRefresh: tile.autoRefresh,
          isPinned: tile.isPinned,
          isLoading: tile.isLoading,
          hasError: tile.error,
          rawApiData: tile.rawData,
        }
      };
    }

    return {
      ...baseData,
      data: {
        ...baseData.data,
        symbol: tile.symbol,
        timeframe: tile.timeframe,
        
        // Financial metrics
        currentPrice: cryptoData.currentPrice,
        priceChange: cryptoData.return24h,
        priceChangePercent: cryptoData.return24h,
        annualReturn: cryptoData.annualReturn,
        volatility: cryptoData.annualizedVolatility,
        volume: cryptoData.volume24h,
        marketCap: cryptoData.marketCap,
        
        // Chart data
        chartData: cryptoData.chartData || [],
        
        // Configuration
        displayOptions: tile.displayOptions,
        autoRefresh: tile.autoRefresh,
        isPinned: tile.isPinned,
        
        // Status
        isLoading: tile.isLoading,
        hasError: tile.error,
        
        // Raw data for advanced analysis
        rawApiData: cryptoData,
      }
    };
  }

  /**
   * Extract stock-specific data
   */
  private static extractStockData(tile: any, baseData: ExtractedTileData): ExtractedTileData {
    const stockData = tile.stockData || tile.data;
    
    if (!stockData) {
      return {
        ...baseData,
        data: {
          ...baseData.data,
          symbol: tile.symbol,
          timeframe: tile.timeframe,
          displayOptions: tile.displayOptions,
          autoRefresh: tile.autoRefresh,
          isPinned: tile.isPinned,
          isLoading: tile.isLoading,
          hasError: tile.error,
          rawApiData: tile.rawData,
        }
      };
    }

    // Process chart data from stock API
    let chartData: any[] = [];
    if (stockData.chart_data && Array.isArray(stockData.chart_data)) {
      chartData = stockData.chart_data.map((point: any) => ({
        time: point.time,
        price: point.close,
        volume: point.volume,
        date: new Date(point.time * 1000).toLocaleDateString(),
        timeLabel: point.time_label || new Date(point.time * 1000).toLocaleTimeString()
      }));
    }

    return {
      ...baseData,
      data: {
        ...baseData.data,
        symbol: tile.symbol,
        timeframe: tile.timeframe,
        
        // Financial metrics
        currentPrice: stockData.current_price,
        priceChange: stockData.price_change_24h,
        priceChangePercent: stockData.price_change_24h,
        annualReturn: stockData.annual_return,
        volatility: stockData.volatility,
        volume: stockData.volume_24h,
        
        // Chart data
        chartData,
        
        // Configuration
        displayOptions: tile.displayOptions,
        autoRefresh: tile.autoRefresh,
        isPinned: tile.isPinned,
        
        // Status
        isLoading: tile.isLoading,
        hasError: tile.error,
        
        // Raw data for advanced analysis
        rawApiData: stockData,
      }
    };
  }

  /**
   * Extract placeholder tile data
   */
  private static extractPlaceholderData(tile: any, baseData: ExtractedTileData): ExtractedTileData {
    return {
      ...baseData,
      data: {
        ...baseData.data,
        title: tile.title,
        displayOptions: tile.displayOptions,
        rawApiData: tile,
      }
    };
  }

  /**
   * Format extracted data for AI consumption
   */
  static formatForAI(tilesData: Record<string, ExtractedTileData>): string {
    const summary = {
      totalTiles: Object.keys(tilesData).length,
      tileTypes: this.getTileTypeSummary(tilesData),
      extractedAt: new Date().toISOString(),
      data: tilesData
    };

    return JSON.stringify(summary, null, 2);
  }

  /**
   * Get summary of tile types
   */
  private static getTileTypeSummary(tilesData: Record<string, ExtractedTileData>): Record<string, number> {
    const summary: Record<string, number> = {};
    
    Object.values(tilesData).forEach(tile => {
      summary[tile.type] = (summary[tile.type] || 0) + 1;
    });

    return summary;
  }

  /**
   * Validate extracted data
   */
  static validateExtractedData(data: ExtractedTileData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!data.uuid) errors.push('Missing UUID');
    if (!data.type) errors.push('Missing type');
    if (!data.data.title) errors.push('Missing title');

    // Type-specific validation
    if (data.type === 'crypto' || data.type === 'stock') {
      if (!data.data.symbol) errors.push('Missing symbol for financial tile');
      if (!data.data.timeframe) errors.push('Missing timeframe for financial tile');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

export default TileDataParser;
