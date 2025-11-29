/**
 * Enhanced Securities Suggestions Service
 * Loads and provides autocomplete suggestions for securities from StockList files
 */

export interface Security {
  symbol: string;
  name: string;
  marketCap: 'high' | 'mid' | 'low';
  displayText: string; // Combined display format: "AAPL - Apple Inc. (High Cap)"
  searchText: string; // Combined text for searching
}

class SecuritySuggestionsServiceV2 {
  private securities: Security[] = [];
  private isLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Load securities from StockList CSV files
   */
  async loadSecurities(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._loadSecuritiesInternal();
    await this.loadingPromise;
  }

  private async _loadSecuritiesInternal(): Promise<void> {
    try {
      console.log('📈 Loading securities data from StockList...');
      
      const marketCapFiles = [
        { file: '/data/StockList/highcap.csv', marketCap: 'high' as const },
        { file: '/data/StockList/midcap.csv', marketCap: 'mid' as const },
        { file: '/data/StockList/lowcap.csv', marketCap: 'low' as const },
      ];

      const allSecurities: Security[] = [];

      for (const { file, marketCap } of marketCapFiles) {
        try {
          console.log(`📊 Loading ${marketCap} cap securities from ${file}...`);
          
          const response = await fetch(file);
          if (!response.ok) {
            console.warn(`⚠️ Failed to load ${file}: ${response.status}`);
            continue;
          }

          const csvText = await response.text();
          const lines = csvText.split('\n');
          
          if (lines.length < 2) {
            console.warn(`⚠️ Invalid CSV format for ${file}`);
            continue;
          }

          // Parse CSV header (expecting: Symbol,Security Name)
          const headers = this._parseCsvLine(lines[0]);
          console.log(`📋 ${marketCap} cap headers:`, headers);

          const symbolIndex = headers.findIndex(h => 
            h.toLowerCase().includes('symbol') || h.toLowerCase().includes('ticker')
          );
          const nameIndex = headers.findIndex(h => 
            h.toLowerCase().includes('name') || h.toLowerCase().includes('security')
          );

          if (symbolIndex === -1 || nameIndex === -1) {
            console.warn(`⚠️ Required columns not found in ${file}`);
            continue;
          }

          // Parse data rows
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
              const values = this._parseCsvLine(line);
              
              const symbol = (values[symbolIndex] || '').trim().toUpperCase();
              const name = (values[nameIndex] || '').trim();

              if (!symbol || !name) continue;

              // Remove quotes if present
              const cleanName = name.replace(/^"(.*)"$/, '$1');

              // Create display and search text
              const capLabel = marketCap === 'high' ? 'High Cap' : marketCap === 'mid' ? 'Mid Cap' : 'Low Cap';
              const displayText = `${symbol} - ${cleanName} (${capLabel})`;
              const searchText = `${symbol} ${cleanName} ${capLabel}`.toLowerCase();

              allSecurities.push({
                symbol,
                name: cleanName,
                marketCap,
                displayText,
                searchText,
              });
            } catch (error) {
              console.warn(`⚠️ Error parsing line ${i + 1} in ${file}:`, error);
              continue;
            }
          }

          console.log(`✅ Loaded ${allSecurities.filter(s => s.marketCap === marketCap).length} ${marketCap} cap securities`);
          
        } catch (error) {
          console.error(`❌ Failed to load ${file}:`, error);
          continue;
        }
      }

      // Sort securities by market cap priority (high > mid > low) then alphabetically
      allSecurities.sort((a, b) => {
        const capOrder = { 'high': 0, 'mid': 1, 'low': 2 };
        const capDiff = capOrder[a.marketCap] - capOrder[b.marketCap];
        if (capDiff !== 0) return capDiff;
        return a.symbol.localeCompare(b.symbol);
      });

      this.securities = allSecurities;
      this.isLoaded = true;
      
      console.log(`✅ Loaded ${allSecurities.length} total securities`);
      console.log('📊 Securities by market cap:', {
        high: allSecurities.filter(s => s.marketCap === 'high').length,
        mid: allSecurities.filter(s => s.marketCap === 'mid').length,
        low: allSecurities.filter(s => s.marketCap === 'low').length,
      });
      console.log('🔍 Sample securities:', allSecurities.slice(0, 5).map(s => s.displayText));
      
    } catch (error) {
      console.error('❌ Failed to load securities:', error);
      throw error;
    }
  }

  /**
   * Parse CSV line handling quotes and commas properly
   */
  private _parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add final field
    result.push(current.trim());
    return result;
  }

  /**
   * Get all securities
   */
  getAllSecurities(): Security[] {
    return [...this.securities];
  }

  /**
   * Get securities suggestions based on query
   */
  getSuggestions(query: string, limit: number = 50): Security[] {
    if (!query || query.length < 1) {
      return this.securities.slice(0, limit);
    }

    const queryLower = query.toLowerCase();
    const results: Security[] = [];

    // Exact symbol matches first
    const exactSymbolMatches = this.securities.filter(security =>
      security.symbol.toLowerCase() === queryLower
    );
    results.push(...exactSymbolMatches);

    // Symbol starts with query
    if (results.length < limit) {
      const symbolStartMatches = this.securities.filter(security =>
        security.symbol.toLowerCase().startsWith(queryLower) &&
        !exactSymbolMatches.includes(security)
      );
      results.push(...symbolStartMatches.slice(0, limit - results.length));
    }

    // Name starts with query
    if (results.length < limit) {
      const nameStartMatches = this.securities.filter(security =>
        security.name.toLowerCase().startsWith(queryLower) &&
        !results.includes(security)
      );
      results.push(...nameStartMatches.slice(0, limit - results.length));
    }

    // Contains in name or symbol
    if (results.length < limit) {
      const containsMatches = this.securities.filter(security =>
        security.searchText.includes(queryLower) &&
        !results.includes(security)
      );
      results.push(...containsMatches.slice(0, limit - results.length));
    }

    return results.slice(0, limit);
  }

  /**
   * Get securities by market cap
   */
  getSecuritiesByMarketCap(marketCap: 'high' | 'mid' | 'low'): Security[] {
    return this.securities.filter(security => security.marketCap === marketCap);
  }

  /**
   * Get count by market cap
   */
  getCountByMarketCap(): { high: number; mid: number; low: number; total: number } {
    const high = this.securities.filter(s => s.marketCap === 'high').length;
    const mid = this.securities.filter(s => s.marketCap === 'mid').length;
    const low = this.securities.filter(s => s.marketCap === 'low').length;
    
    return { high, mid, low, total: high + mid + low };
  }

  /**
   * Check if data is loaded
   */
  isDataLoaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Find security by symbol
   */
  findBySymbol(symbol: string): Security | undefined {
    return this.securities.find(security => 
      security.symbol.toLowerCase() === symbol.toLowerCase()
    );
  }
}

// Export singleton instance
export const securitySuggestionsServiceV2 = new SecuritySuggestionsServiceV2();
