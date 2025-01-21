import streamlit as st
import numpy as np
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
from scipy.stats import norm
import math
import plotly.graph_objects as go
import yfinance as yf

st.set_page_config(layout="wide", page_title="Black-Scholes Calculator", page_icon="📈")

# Predefined list of stock tickers for suggestions (can be expanded)
STOCK_TICKERS = [
    "AAPL", "TSLA", "GOOGL", "AMZN", "MSFT", "META", "NFLX", "NVDA", "SPY", "VTI",
    "MSCI", "BA", "GE", "INTC", "IBM", "DIS", "GS", "WMT", "JPM", "BABA"
]

def black_scholes(S, K, T, r, sigma, option_type="call"):
    """
    Calculate the price of a European option using the Black-Scholes formula.
    """
    d1 = (math.log(S / K) + (r + (sigma ** 2) / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)

    if option_type.lower() == "call":
        price = S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
    elif option_type.lower() == "put":
        price = K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
    else:
        raise ValueError("Invalid option type. Use 'call' or 'put'.")
    return price

def fetch_volatility(ticker, period="1y"):
    """
    Fetch volatility (standard deviation of returns) for a stock using yfinance.
    """
    stock = yf.Ticker(ticker)
    df = stock.history(period=period)
    df['log_return'] = np.log(df['Close'] / df['Close'].shift(1))
    volatility = df['log_return'].std() * np.sqrt(252)  # Annualized volatility (252 trading days in a year)
    return volatility

# Streamlit Application
st.title("Black-Scholes Option Pricing Calculator")

# Add a section for stock volatility search above the main content
st.header("Stock Volatility Fetcher")

# Search Bar for Stock Ticker with Suggestions
ticker_input = st.text_input("Enter Stock Ticker Symbol (e.g., AAPL, TSLA)", value="AAPL")
search_suggestions = [ticker for ticker in STOCK_TICKERS if ticker.startswith(ticker_input.upper())]

# Display search suggestions if there are any
if search_suggestions:
    st.write("Suggestions: ", ", ".join(search_suggestions))

fetch_volatility_button = st.button("Fetch Volatility")

# Display Volatility
volatility_display = st.empty()

# Fetch volatility when button is clicked
if fetch_volatility_button and ticker_input:
    try:
        volatility = fetch_volatility(ticker_input)
        volatility_display.markdown(f"**Volatility for {ticker_input.upper()}:** {volatility:.4f}")
    except Exception as e:
        volatility_display.markdown(f"Error fetching volatility: {str(e)}")

# Divider line
st.markdown("---")

# Sidebar Inputs for the Black-Scholes formula
st.sidebar.header("Input Parameters for Option Pricing")
S = st.sidebar.number_input("Current Stock Price (S)", min_value=0.0, step=1.0, value=100.0)
K = st.sidebar.number_input("Strike Price (K)", min_value=0.0, step=1.0, value=110.0)
T = st.sidebar.number_input("Time to Maturity (T) (in years)", min_value=0.01, step=0.01, value=1.0)
r = st.sidebar.number_input("Risk-Free Interest Rate (r) (as a decimal)", min_value=0.0, step=0.01, value=0.05)
sigma = st.sidebar.number_input("Volatility (σ) (as a decimal)", min_value=0.0, step=0.01, value=0.2)

# Create empty spaces for live readings of call and put prices
call_price_placeholder = st.empty()
put_price_placeholder = st.empty()

# Update live reading of option prices
def update_option_prices():
    call_price = black_scholes(S, K, T, r, sigma, option_type="call")
    put_price = black_scholes(S, K, T, r, sigma, option_type="put")
    
    # Display the updated option prices in the placeholders with custom styling
    call_price_placeholder.markdown(f"""
    <div style="background-color: green; color: white; padding: 20px; text-align: center; font-size: 24px; border-radius: 10px;">
        Call Option Price: ${call_price:.2f}
    </div>
    """, unsafe_allow_html=True)
    
    put_price_placeholder.markdown(f"""
    <div style="background-color: red; color: white; padding: 20px; text-align: center; font-size: 24px; border-radius: 10px;">
        Put Option Price: ${put_price:.2f}
    </div>
    """, unsafe_allow_html=True)

# Initial update to show prices when inputs change
update_option_prices()

# Divider line
st.markdown("---")

# Heatmap Functionality
st.header("Heatmaps: Option Price as a Function of Stock Price and Volatility")
st.write(
    "Visualize how Call and Put option prices change with different stock prices and volatilities."
)

# Sidebar Inputs for the Heatmap
st.sidebar.header("Heatmap Parameters")
min_S = st.sidebar.number_input("Minimum Stock Price (S)", min_value=0.0, step=1.0, value=50.0)
max_S = st.sidebar.number_input("Maximum Stock Price (S)", min_value=0.0, step=1.0, value=150.0)
min_sigma = st.sidebar.slider("Minimum Volatility (σ)", 0.01, 1.0, 0.1)
max_sigma = st.sidebar.slider("Maximum Volatility (σ)", 0.01, 1.0, 0.5)

# Generate heatmap data
stock_prices = np.linspace(min_S, max_S, 10)
volatilities = np.linspace(min_sigma, max_sigma, 10)

call_heatmap_data = np.zeros((10, 10))
put_heatmap_data = np.zeros((10, 10))

for i, S_val in enumerate(stock_prices):
    for j, sigma_val in enumerate(volatilities):
        call_heatmap_data[i, j] = black_scholes(S_val, K, T, r, sigma_val, "call")
        put_heatmap_data[i, j] = black_scholes(S_val, K, T, r, sigma_val, "put")

# Create the Plotly heatmap for Call options
call_heatmap_fig = go.Figure(data=go.Heatmap(
    z=call_heatmap_data,
    x=[f"σ={sigma:.2f}" for sigma in volatilities],
    y=[f"S={S:.2f}" for S in stock_prices],
    colorscale='RdYlGn',
    colorbar=dict(title="Call Option Price"),
    hoverongaps=False,
    hovertemplate='Stock Price: %{y}<br>Volatility: %{x}<br>Price: $%{z:.2f}'  # Hover template with price display
))

# Create the Plotly heatmap for Put options
put_heatmap_fig = go.Figure(data=go.Heatmap(
    z=put_heatmap_data,
    x=[f"σ={sigma:.2f}" for sigma in volatilities],
    y=[f"S={S:.2f}" for S in stock_prices],
    colorscale='RdYlGn',
    colorbar=dict(title="Put Option Price"),
    hoverongaps=False,
    hovertemplate='Stock Price: %{y}<br>Volatility: %{x}<br>Price: $%{z:.2f}'  # Hover template with price display
))

# Add annotations to the heatmap cells for the option prices
for i in range(len(stock_prices)):
    for j in range(len(volatilities)):
        call_heatmap_fig.add_annotation(
            x=f"σ={volatilities[j]:.2f}",
            y=f"S={stock_prices[i]:.2f}",
            text=f"${call_heatmap_data[i, j]:.2f}",
            showarrow=False,
            font=dict(size=12, color="black")
        )
        put_heatmap_fig.add_annotation(
            x=f"σ={volatilities[j]:.2f}",
            y=f"S={stock_prices[i]:.2f}",
            text=f"${put_heatmap_data[i, j]:.2f}",
            showarrow=False,
            font=dict(size=12, color="black")
        )

# Update layout for both heatmaps
call_heatmap_fig.update_layout(
    title="Call Option Price Heatmap",
    xaxis_title="Volatility (σ)",
    yaxis_title="Stock Price (S)",
    height=500
)

put_heatmap_fig.update_layout(
    title="Put Option Price Heatmap",
    xaxis_title="Volatility (σ)",
    yaxis_title="Stock Price (S)",
    height=500
)

# Display the heatmaps
st.plotly_chart(call_heatmap_fig, use_container_width=True)
st.plotly_chart(put_heatmap_fig, use_container_width=True)
