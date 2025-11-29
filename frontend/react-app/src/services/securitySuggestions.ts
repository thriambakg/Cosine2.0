export type SecurityCategory = 'high-cap' | 'mid-cap' | 'low-cap' | 'other';

interface Security {
  symbol: string;
  name: string;
  category: SecurityCategory;
}

class SecuritySuggestionsService {
  private securities: Security[] = [];
  private isLoaded = false;



  async loadSecurities(): Promise<void> {
    if (this.isLoaded) return;

    try {
      console.log('🏦 Loading security data from CSV files...');
      
      const files = [
        { path: '/data/StockList/highcap.csv', category: 'high-cap' as const },
        { path: '/data/StockList/midcap.csv', category: 'mid-cap' as const },
        { path: '/data/StockList/lowcap.csv', category: 'low-cap' as const }
      ];

      const allSecurities: Security[] = [];

      for (const file of files) {
        try {
          const response = await fetch(file.path);
          if (!response.ok) {
            console.warn(`⚠️ Failed to load ${file.path}: ${response.status}`);
            continue;
          }

          const csvText = await response.text();
          const securities = this.parseCSV(csvText, file.category);
          allSecurities.push(...securities);
          console.log(`✅ Loaded ${securities.length} securities from ${file.category} file`);
        } catch (error) {
          console.error(`❌ Error loading ${file.path}:`, error);
        }
      }

      // Global deduplication across all files (prioritize higher market cap)
      const globalSeen = new Map<string, Security>();
      const categoryPriority = { 'high-cap': 4, 'mid-cap': 3, 'low-cap': 2, 'other': 1 };

      for (const security of allSecurities) {
        const key = `${security.symbol}|${security.name}`;
        const existing = globalSeen.get(key);
        
        if (!existing || categoryPriority[security.category] > categoryPriority[existing.category]) {
          globalSeen.set(key, security);
        }
      }

      this.securities = Array.from(globalSeen.values());
      this.isLoaded = true;
      
      console.log(`🏦 Security suggestions service loaded with ${this.securities.length} total unique securities from stock lists`);
    } catch (error) {
      console.error('❌ Failed to load security data:', error);
      this.securities = [];
    }
  }

  private parseCSV(csvText: string, category: 'high-cap' | 'mid-cap' | 'low-cap'): Security[] {
    const lines = csvText.trim().split('\n');
    const securities: Security[] = [];
    const seen = new Set<string>(); // Track unique symbol+name combinations

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        // Handle CSV parsing with proper quote handling
        const match = line.match(/^([^,]+),\"?([^\"]+)\"?$/);
        if (match) {
          const symbol = match[1].trim();
          const name = match[2].replace(/"/g, '').trim();
          
          if (symbol && name) {
            // Create a unique identifier to prevent duplicates
            const uniqueKey = `${symbol}|${name}`;
            
            if (!seen.has(uniqueKey)) {
              seen.add(uniqueKey);
              securities.push({
                symbol,
                name,
                category
              });
            }
          }
        }
      } catch (error) {
        console.warn('⚠️ Failed to parse CSV line:', line, error);
      }
    }

    return securities;
  }

  getSuggestions(query: string, maxResults: number = 10): Security[] {
    if (!query || query.length < 2) return [];
    
    const queryLower = query.toLowerCase().trim();
    const scored: Array<{ security: Security; score: number }> = [];

    for (const security of this.securities) {
      const score = this.calculateScore(security, queryLower);
      if (score > 0) {
        scored.push({ security, score });
      }
    }

    // Sort by score (highest first), then by category preference (high-cap first)
    scored.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      
      // If scores are equal, prioritize by category
      const categoryPriority = { 'high-cap': 4, 'mid-cap': 3, 'low-cap': 2, 'other': 1 };
      return categoryPriority[a.security.category] - categoryPriority[b.security.category];
    });

    return scored.slice(0, maxResults).map(item => item.security);
  }

  private calculateScore(security: Security, queryLower: string): number {
    const symbolLower = security.symbol.toLowerCase();
    const nameLower = security.name.toLowerCase();

    let score = 0;

    // Exact symbol match (highest priority)
    if (symbolLower === queryLower) {
      score += 1000;
    }
    // Symbol starts with query
    else if (symbolLower.startsWith(queryLower)) {
      score += 800;
    }
    // Symbol contains query
    else if (symbolLower.includes(queryLower)) {
      score += 400;
    }

    // Exact name match
    if (nameLower === queryLower) {
      score += 900;
    }
    // Name starts with query
    else if (nameLower.startsWith(queryLower)) {
      score += 600;
    }
    // Name words start with query
    else {
      const nameWords = nameLower.split(/\s+/);
      for (const word of nameWords) {
        if (word.startsWith(queryLower)) {
          score += 300;
          break;
        }
      }
      
      // Name contains query
      if (nameLower.includes(queryLower)) {
        score += 200;
      }
    }

    // Boost score for higher market cap categories
    if (security.category === 'high-cap') {
      score += 50;
    } else if (security.category === 'mid-cap') {
      score += 25;
    }

    // Boost shorter symbols (more likely to be major stocks)
    if (security.symbol.length <= 4) {
      score += 10;
    }

    return score;
  }

  // Method to get a security by exact symbol match
  getSecurityBySymbol(symbol: string): Security | undefined {
    return this.securities.find(s => s.symbol.toLowerCase() === symbol.toLowerCase());
  }

  // Method to get a security by exact name match
  getSecurityByName(name: string): Security | undefined {
    return this.securities.find(s => s.name.toLowerCase() === name.toLowerCase());
  }

  // Method to convert user selection to search params for lambda
  formatForSearch(selectedSecurity: Security | string): { securitySymbol?: string; securityName?: string } {
    if (typeof selectedSecurity === 'string') {
      // User typed something that didn't match our list
      // Try to determine if it's a symbol or name
      const trimmed = selectedSecurity.trim();
      
      // If it's short and uppercase, likely a symbol
      if (trimmed.length <= 6 && trimmed === trimmed.toUpperCase()) {
        return { securitySymbol: trimmed };
      }
      
      // Otherwise, treat as name or partial name
      return { securityName: trimmed };
    }
    
    // User selected from our suggestions
    return {
      securitySymbol: selectedSecurity.symbol,
      securityName: selectedSecurity.name
    };
  }

  getTotalCount(): number {
    return this.securities.length;
  }

  getCountByCategory(): Record<string, number> {
    const counts: Record<string, number> = { 'high-cap': 0, 'mid-cap': 0, 'low-cap': 0 };
    for (const security of this.securities) {
      if (security.category in counts) {
        counts[security.category]++;
      }
    }
    return counts;
  }
}

// Export singleton instance
export const securitySuggestionsService = new SecuritySuggestionsService();
export type { Security };
