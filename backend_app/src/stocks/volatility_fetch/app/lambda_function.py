import yfinance as yf
import numpy as np

def fetch_volatility(ticker, period="1y"):
    """
    Fetch volatility (standard deviation of returns) for a stock using yfinance.
    """
    stock = yf.Ticker(ticker)
    df = stock.history(period=period)
    df['log_return'] = np.log(df['Close'] / df['Close'].shift(1))
    volatility = df['log_return'].std() * np.sqrt(252)  # Annualized volatility (252 trading days in a year)
    return volatility
