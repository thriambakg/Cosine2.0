import cryptocompare
import pandas as pd
import numpy as np
from datetime import datetime

def lambda_handler(selected_crypto_symbol, period=365):
    """
    Fetch cryptocurrency statistics without error handling except for exceptions.

    Args:
        selected_crypto_symbol (str): Cryptocurrency ticker symbol (e.g., 'BTC').
        period (int): Number of days for historical data.

    Returns:
        dict: Cryptocurrency statistics or error message.
    """
    try:
        # Fetch historical data for the selected crypto from CryptoCompare
        raw_data = cryptocompare.get_historical_price_day(
            selected_crypto_symbol,  # Ticker symbol (e.g., 'BTC')
            currency='USD',
            limit=period,  # Fetch `period` days of data
            toTs=int(datetime.now().timestamp())
        )

        # Convert the raw data to a DataFrame for easier handling
        df = pd.DataFrame(raw_data)

        # Convert 'time' to datetime and set it as the index
        df['time'] = pd.to_datetime(df['time'], unit='s', errors='coerce')
        df.set_index('time', inplace=True)

        # Drop any rows with missing data
        df.dropna(subset=['close'], inplace=True)

        # Ensure the DataFrame has enough data to calculate statistics
        if len(df) < 2:
            return {"error": "Not enough data to calculate statistics"}

        # Calculate today's return and percentage change
        current_price = df['close'].iloc[-1]
        previous_price = df['close'].iloc[-2]
        price_change_24h = (current_price - previous_price) / previous_price * 100

        # Calculate the annual return based on the first and last price of the period
        start_price = df['close'].iloc[0]
        annual_return = (current_price - start_price) / start_price * 100

        # Calculate annualized volatility (standard deviation of daily returns)
        df['log_return'] = np.log(df['close'] / df['close'].shift(1))
        volatility = df['log_return'].std() * (252 ** 0.5)  # Annualized volatility (252 trading days)

        # Return the statistics as a dictionary
        stats = {
            "current_price": current_price,
            "price_change_24h": price_change_24h,
            "annual_return": annual_return,
            "volatility": volatility * 100  # Convert to percentage
        }
        return stats

    except Exception as e:
        return {"error": f"Error fetching data for {selected_crypto_symbol}: {str(e)}"}
