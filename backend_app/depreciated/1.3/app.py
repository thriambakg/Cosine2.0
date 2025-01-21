import streamlit as st
import yfinance as yf
import pandas as pd
import re

# Import custom modules
from cache_utils import (
    cached_fetch_volatility, 
    cached_get_crypto_stats, 
    safe_fetch_stock_price, 
    initialize_session_state
)
from options.black_scholes import black_scholes
from stocks.volatility_fetcher import fetch_volatility
from options.heatmap_generator import generate_heatmaps
from stocks.risk_return import calculate_portfolio_metrics as calculate_portfolio_risk
from stocks.stock_alert import monitor_stock

# Initial Setup
st.set_page_config(layout="wide", page_title="Cosine", page_icon="📈")

# Predefined stock tickers
STOCK_TICKERS = [
    "AAPL", "TSLA", "GOOGL", "AMZN", "MSFT", "META", 
    "NFLX", "NVDA", "SPY", "VTI", "MSCI", "BA", "GE", 
    "INTC", "IBM", "DIS", "GS", "WMT", "JPM", "BABA"
]

def main():
    # Initialize session state
    initialize_session_state()

    st.title("Cosine - Your Interactive Investment Assistant")

    # Time Frame Selection
    try:
        time_frame_selection()
    except Exception as e:
        st.error(f"An error occurred in Time Frame Selection: {e}")
    st.markdown("---")

    # Stock Volatility Section
    try:
        stock_volatility_section()
    except Exception as e:
        st.error(f"An error occurred in Stock Volatility Section: {e}")
    st.markdown("---")

    # Cryptocurrency Statistics
    try:
        crypto_stats_section()
    except Exception as e:
        st.error(f"An error occurred in Cryptocurrency Statistics: {e}")
    st.markdown("---")

    # Portfolio Risk Calculator
    try:
        portfolio_risk_section()
    except Exception as e:
        st.error(f"An error occurred in Portfolio Risk Calculator: {e}")
    st.markdown("---")

    # Stock Alerts Section
    try:
        stock_alerts_section()
    except Exception as e:
        st.error(f"An error occurred in Stock Alerts Section: {e}")
    st.markdown("---")

    # Black-Scholes Option Pricing
    try:
        option_pricing_section()
    except Exception as e:
        st.error(f"An error occurred in Black-Scholes Option Pricing: {e}")
    st.markdown("---")

    # Heatmap Visualization
    try:
        heatmap_section()
    except Exception as e:
        st.error(f"An error occurred in Heatmap Visualization: {e}")
    st.markdown("---")

def stock_alerts_section():
    st.header("Stock Price Alerts")
    st.write("Set up email alerts for when stocks reach your target price.")

    # Email input with validation
    email = st.text_input("Email Address")
    if email and not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        st.error("Please enter a valid email address")
        return

    # Stock ticker input with suggestions
    ticker = st.text_input("Stock Ticker Symbol").upper()
    if ticker:
        search_suggestions = [t for t in STOCK_TICKERS if t.startswith(ticker)]
        if search_suggestions:
            st.write("Suggestions: ", ", ".join(search_suggestions))



    # Comparison dropdown for greater than or less than
    comparison_choice = st.selectbox(
        "Price Condition",
        options=["Greater Than", "Less Than"],
        index=0,
        help="Choose whether to trigger the alert when the price is greater than or less than the threshold."
    )
    comparison_mode = 1 if comparison_choice == "Greater Than" else 0

    # Price threshold input
    price_threshold = st.number_input("Price Threshold ($)", min_value=0.01, step=0.01)

    # Add alert button
    if st.button("Add Alert"):
        if email and ticker and price_threshold > 0:
            # Validate stock ticker
            try:
                current_price = safe_fetch_stock_price(ticker)
                if current_price is not None:
                    new_alert = {
                        "email": email,
                        "ticker": ticker,
                        "price_threshold": price_threshold,
                        "current_price": current_price,
                        "comparison_mode": "Greater Than" if comparison_mode == 1 else "Less Than"
                    }
                    st.session_state.alerts.append(new_alert)

                    # Monitor stock
                    try:
                        monitor_stock(email, ticker, price_threshold, comparison_mode)
                        st.success(
                            f"Alert set for {ticker} when price is {'above' if comparison_mode == 1 else 'below'} ${price_threshold:.2f}."
                        )
                    except Exception as e:
                        st.error(f"Error setting up alert: {str(e)}")
                else:
                    st.error(f"Could not validate stock ticker {ticker}")
            except Exception as e:
                st.error(f"Error validating stock ticker: {str(e)}")
        else:
            st.error("Please fill in all fields")

    # Display existing alerts
    if st.session_state.alerts:
        st.subheader("Your Active Alerts")
        alerts_df = pd.DataFrame(st.session_state.alerts)
        alerts_df = alerts_df.rename(columns={
            "email": "Email",
            "ticker": "Stock",
            "price_threshold": "Alert Price",
            "current_price": "Current Price",
            "comparison_mode": "Condition"
        })
        
        # Format price columns
        alerts_df["Alert Price"] = alerts_df["Alert Price"].map("${:.2f}".format)
        alerts_df["Current Price"] = alerts_df["Current Price"].map("${:.2f}".format)
        
        st.dataframe(alerts_df)

        if st.button("Clear All Alerts"):
            st.session_state.alerts = []
            st.success("All alerts cleared")

def time_frame_selection():
    st.sidebar.header("Time frame involved in Analytics")
    
    time_frame = st.sidebar.selectbox(
        "Select Time Frame",
        options=["6mo", "1y", "5y"],
        index=["6mo", "1y", "5y"].index(st.session_state["time_frame"])
    )
    # Update time-dependent sections if time frame changes
    if st.session_state["time_frame"] != time_frame:
        st.session_state["previous_time_frame"] = st.session_state["time_frame"]
        st.session_state["time_frame"] = time_frame

        # Update only if results are already displayed
        if st.session_state.portfolio_risk_results:
            calculate_and_update_portfolio_risk()
        else:
            update_time_dependent_sections(time_frame)

def update_time_dependent_sections(new_time_frame):
    try:
        # Volatility Update
        current_ticker = st.session_state.get("current_volatility_ticker", "AAPL")
        st.session_state["current_volatility"] = cached_fetch_volatility(
            fetch_volatility, current_ticker, new_time_frame
        )

        # Crypto Stats Update
        time_frame_mapping = {"6mo": 182, "1y": 365, "5y": 1825}
        time_frame_mapped = time_frame_mapping[new_time_frame]
        
        selected_crypto = st.session_state.get("selected_crypto", "BTC")
        st.session_state["crypto_stats"] = cached_get_crypto_stats(selected_crypto, time_frame_mapped)

    except Exception as e:
        st.error(f"Error updating time-dependent sections: {e}")

def stock_volatility_section():
    # Stock Volatility Fetcher section implementation
    st.header("Stock Volatility Fetcher")
    ticker_input = st.text_input("Enter Stock Ticker Symbol", value="AAPL")
    
    # Efficient suggestions
    search_suggestions = [
        ticker for ticker in STOCK_TICKERS if ticker.startswith(ticker_input.upper())
    ]
    
    if search_suggestions:
        st.write("Suggestions: ", ", ".join(search_suggestions))

    fetch_volatility_button = st.button("Fetch Volatility")

    if fetch_volatility_button and ticker_input:
        try:
            volatility = cached_fetch_volatility(
                fetch_volatility, ticker_input, st.session_state["time_frame"]
            )
            st.markdown(f"**Volatility for {ticker_input.upper()}:** {volatility:.4f}")
        except Exception as e:
            st.error(f"Error fetching volatility: {str(e)}")

def crypto_stats_section():
    st.header("Cryptocurrency Statistics")
    crypto_symbols = ['BTC', 'ETH', 'XRP', 'LTC', 'DOGE', 'ADA', 'SOL']
    
    selected_crypto_symbol = st.selectbox(
        "Select a Cryptocurrency", 
        options=crypto_symbols, 
        help="Select a cryptocurrency to get detailed information"
    )

    time_frame_mapping = {"6mo": 182, "1y": 365, "5y": 1825}
    time_frame_mapped = time_frame_mapping[st.session_state["time_frame"]]

    if selected_crypto_symbol:
        stats = cached_get_crypto_stats(selected_crypto_symbol, time_frame_mapped)

        if not isinstance(stats, dict) or "error" in stats:
            st.error(stats.get("error", "Unable to fetch cryptocurrency statistics"))
            return

        # Compact metric display
        cols = st.columns(4)
        metrics = [
            ("Current Price (USD)", f"${stats['current_price']:,.2f}"),
            ("24h Return (%)", f"{stats['price_change_24h']:.2f}%"),
            ("Annual Return (%)", f"{stats['annual_return']:.2f}%"),
            ("Annualized Volatility (%)", f"{stats['volatility']:.2f}%")
        ]

        for col, (label, value) in zip(cols, metrics):
            col.metric(label, value)

def option_pricing_section():
    """
    Handles Black-Scholes option pricing calculations and display
    """
    st.header("Black-Scholes Calculation")

    st.sidebar.header("Black-Scholes Calculation Input Parameters")

    # Move sidebar inputs outside of cached function
    sidebar_inputs = {
        "S": st.sidebar.number_input("Current Stock Price (S)", 
                                   min_value=0.0, step=1.0, value=100.0),
        "K": st.sidebar.number_input("Strike Price (K)", 
                                   min_value=0.0, step=1.0, value=110.0),
        "T": st.sidebar.number_input("Time to Maturity (T) (in years)", 
                                   min_value=0.01, step=0.01, value=1.0),
        "r": st.sidebar.number_input("Risk-Free Interest Rate (r) (as a decimal)", 
                                   min_value=0.0, step=0.01, value=0.05),
        "sigma": st.sidebar.number_input("Volatility (σ) (as a decimal)", 
                                      min_value=0.0, step=0.01, value=0.2)
    }
    
    # Create containers for option prices
    call_price_container = st.container()
    put_price_container = st.container()

    # Calculate and display option prices
    with call_price_container:
        call_price = calculate_option_price(
            sidebar_inputs["S"],
            sidebar_inputs["K"],
            sidebar_inputs["T"],
            sidebar_inputs["r"],
            sidebar_inputs["sigma"],
            option_type="call"
        )
        st.markdown(
            f"""
            <div style="background-color: green; color: white; padding: 20px; 
                 text-align: center; font-size: 24px; border-radius: 10px;">
                Call Option Price: ${call_price:.2f}
            </div>
            """,
            unsafe_allow_html=True
        )

    with put_price_container:
        put_price = calculate_option_price(
            sidebar_inputs["S"],
            sidebar_inputs["K"],
            sidebar_inputs["T"],
            sidebar_inputs["r"],
            sidebar_inputs["sigma"],
            option_type="put"
        )
        st.markdown(
            f"""
            <div style="background-color: red; color: white; padding: 20px; 
                 text-align: center; font-size: 24px; border-radius: 10px;">
                Put Option Price: ${put_price:.2f}
            </div>
            """,
            unsafe_allow_html=True
        )

@st.cache_data
def calculate_option_price(S, K, T, r, sigma, option_type):
    """
    Cached function for calculating option prices
    """
    return black_scholes(S, K, T, r, sigma, option_type=option_type)

def heatmap_section():
    st.header("Heatmaps: Option Price as a Function of Stock Price and Volatility")
    st.write("Visualize how Call and Put option prices change with different stock prices and volatilities.")

    # Get heatmap parameters with validation - moved outside of cached function
    st.sidebar.header("Heatmap parameters")
    min_S = st.sidebar.number_input("Minimum Stock Price (S)", min_value=0.0, step=1.0, value=50.0)
    max_S = st.sidebar.number_input("Maximum Stock Price (S)", min_value=0.0, step=1.0, value=150.0)
    min_sigma = st.sidebar.slider("Minimum Volatility (σ)", 0.01, 1.0, 0.1)
    max_sigma = st.sidebar.slider("Maximum Volatility (σ)", 0.01, 1.0, 0.5)
    
    # Package parameters into a dict
    heatmap_params = {
        "min_S": min_S,
        "max_S": max_S,
        "min_sigma": min_sigma,
        "max_sigma": max_sigma
    }

    # Check if parameters have changed
    if has_heatmap_params_changed(heatmap_params):
        update_heatmap(heatmap_params)

    # Display heatmaps from session state
    display_heatmaps()

@st.cache_data
def get_sidebar_inputs():
    """Cached function to get sidebar inputs for BS calculation"""
    return {
        "S": st.session_state.get("S", 100.0),
        "K": st.session_state.get("K", 110.0),
        "T": st.session_state.get("T", 1.0),
        "r": st.session_state.get("r", 0.05),
        "sigma": st.session_state.get("sigma", 0.2)
    }

def has_heatmap_params_changed(new_params):
    """Check if heatmap parameters have changed"""
    current_params = st.session_state.get("heatmap_params", {
        "min_S": None,
        "max_S": None,
        "min_sigma": None,
        "max_sigma": None
    })
    return any(
        current_params.get(key) != value
        for key, value in new_params.items()
    )

@st.cache_data
def cached_generate_heatmaps(S, K, T, r, min_S, max_S, min_sigma, max_sigma):
    """Cached wrapper for heatmap generation"""
    return generate_heatmaps(S, K, T, r, min_S, max_S, min_sigma, max_sigma)

def update_heatmap(params):
    """Update heatmap with new parameters"""
    sidebar_inputs = get_sidebar_inputs()
    st.session_state.heatmaps = cached_generate_heatmaps(
        sidebar_inputs["S"],
        sidebar_inputs["K"],
        sidebar_inputs["T"],
        sidebar_inputs["r"],
        params["min_S"],
        params["max_S"],
        params["min_sigma"],
        params["max_sigma"]
    )
    st.session_state.heatmap_params = params.copy()

def display_heatmaps():
    """Display heatmaps if they exist in session state"""
    if "heatmaps" in st.session_state and st.session_state.heatmaps:
        st.plotly_chart(st.session_state.heatmaps["call"], 
                       use_container_width=True)
        st.plotly_chart(st.session_state.heatmaps["put"], 
                       use_container_width=True)

def portfolio_risk_section():
    st.header("Portfolio Risk Calculator")
    
    # Portfolio management buttons
    col1, col2, col3 = st.columns(3)
    with col1:
        if st.button("Add Stock +"):
            add_portfolio_entry()
    with col2:
        if st.button("Calculate Portfolio Risk"):
            calculate_and_update_portfolio_risk()

    # Display portfolio entries
    display_portfolio_entries()
    
    # Automatically display results if already calculated
    display_portfolio_results()

def add_portfolio_entry():
    st.session_state.portfolio_risk_entries.append({"stock": "", "shares": 0.0})

def remove_portfolio_entry(index):
    del st.session_state.portfolio_risk_entries[index]

def calculate_and_update_portfolio_risk():
    portfolio_tuples = []
    for entry in st.session_state.portfolio_risk_entries:
        if entry["stock"].strip() and entry["shares"] > 0:
            current_price = safe_fetch_stock_price(entry["stock"])
            if current_price is not None:
                portfolio_tuples.append(
                    (entry["stock"].upper(), entry["shares"], current_price)
                )

    if portfolio_tuples:
        try:
            results = calculate_portfolio_risk(
                portfolio_tuples, 
                period=st.session_state.time_frame
            )
            st.session_state.portfolio_risk_results = results
        except Exception as e:
            st.session_state.portfolio_risk_results = {
                "error": f"Error calculating portfolio risk: {str(e)}"
            }
    else:
        st.session_state.portfolio_risk_results = {
            "warning": "Please enter at least one valid stock with shares."
        }

def display_portfolio_entries():
    for i, entry in enumerate(st.session_state.portfolio_risk_entries):
        col1, col2, col3 = st.columns([3, 2, 1])
        
        with col1:
            entry["stock"] = st.text_input(
                f"Stock Ticker {i + 1}",
                value=entry["stock"],
                key=f"stock_input_{i}"
            )

        with col2:
            entry["shares"] = st.number_input(
                f"Number of Shares {i + 1}",
                min_value=0.0,
                value=float(entry["shares"]),
                step=0.1,
                key=f"shares_input_{i}",
                format="%.3f"
            )

        with col3: 
            if st.button("Remove", key=f"remove_{i}"):
                remove_portfolio_entry(i)

def display_portfolio_results():
    if not st.session_state.portfolio_risk_results:
        return

    results = st.session_state.portfolio_risk_results

    if "error" in results:
        st.error(results["error"])
        return
    if "warning" in results:
        st.warning(results["warning"])
        return

    # Define the `cols` variable with st.columns()
    cols = st.columns(4)  # Adjust the number of columns as needed
    metrics = [
        ("Total Portfolio Value", f"${results['total_portfolio_value']:,.2f}"),
        ("Expected Annual Return", f"{results['portfolio_expected_return']:.2f}%"),
        ("Portfolio Volatility", f"{results['portfolio_volatility']:.2f}%"),
        ("Sharpe Ratio", f"{results['sharpe_ratio']:.2f}")
    ]

    for col, (label, value) in zip(cols, metrics):
        col.metric(label, value)

    # Display stock details
    st.subheader("Individual Stock Details")
    display_stock_details(results["stock_details"])

def display_stock_details(stock_details):
    stock_details_df = pd.DataFrame.from_dict(
        {
            ticker: {
                "Weight (%)": details["weight"] * 100,
                "Annual Return (%)": details["annual_return"] * 100,
                "Annual Volatility (%)": details["annual_volatility"] * 100,
                "Shares": details["shares"],
                "Current Price": details["current_price"],
                "Total Value": details["total_value"],
            }
            for ticker, details in stock_details.items()
        },
        orient="index"
    )

    st.dataframe(
        stock_details_df.style.format({
            'Weight (%)': '{:.2f}',
            'Annual Return (%)': '{:.2f}',
            'Annual Volatility (%)': '{:.2f}',
            'Current Price': '${:.2f}',
            'Total Value': '${:,.2f}'
        })
    )

if __name__ == "__main__":
    main()