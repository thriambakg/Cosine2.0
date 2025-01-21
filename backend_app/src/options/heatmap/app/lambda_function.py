import numpy as np
import plotly.graph_objects as go
import math
from scipy.stats import norm

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

def lambda_handler(S, K, T, r, min_S, max_S, min_sigma, max_sigma):
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

    return {"call": call_heatmap_fig, "put": put_heatmap_fig}
