import streamlit as st
from black_scholes import black_scholes
from volatility_fetcher import fetch_volatility
from heatmap_generator import generate_heatmaps
from risk_return import main as calculate_portfolio_risk
import yfinance as yf
import pandas as pd
from crypto.crypto_statistics import get_crypto_stats

# Set page config
st.set_page_config(layout="wide", page_title="Cosine", page_icon="📈")

# Predefined list of stock tickers for suggestions (can be expanded)
STOCK_TICKERS = [
    "AAPL", "TSLA", "GOOGL", "AMZN", "MSFT", "META", "NFLX", "NVDA", "SPY", "VTI",
    "MSCI", "BA", "GE", "INTC", "IBM", "DIS", "GS", "WMT", "JPM", "BABA"
]

st.title("Black-Scholes Option Pricing Calculator")

# Sidebar Header
st.sidebar.header("Time frame involved in Analytics")

# Initialize session state variables if not already set
if "time_frame" not in st.session_state:
    st.session_state["time_frame"] = "1y"  # Default time frame
if "risk_results" not in st.session_state:
    st.session_state["risk_results"] = None  # Placeholder for results

# Dropdown for selecting the time frame
time_frame = st.sidebar.selectbox(
    "Select Time Frame",
    options=["6mo", "1y", "5y"],  # Dropdown options
    index=["6mo", "1y", "5y"].index(st.session_state["time_frame"])  # Set default based on session state
)

# Update the session state with the new time frame
if st.session_state["time_frame"] != time_frame:
    # Custom function to dynamically update portfolio risk and other time-dependent sections
    def update_time_dependent_sections(new_time_frame):
        # Update time frame in session state
        st.session_state["time_frame"] = new_time_frame
        
        # Reset or update time-dependent sections
        
        # 1. Portfolio Risk Section Update
        if "portfolio_risk_entries" in st.session_state and \
           "portfolio_risk_results" in st.session_state and \
           st.session_state["portfolio_risk_results"] is not None:
            
            # Prepare portfolio tuples
            portfolio_tuples = []
            for entry in st.session_state["portfolio_risk_entries"]:
                if entry["stock"].strip() and entry["shares"] > 0:
                    try:
                        # Fetch current stock price
                        stock = yf.Ticker(entry["stock"].upper())
                        current_price = stock.history(period="1d")["Close"].iloc[-1]

                        # Create tuple with stock ticker, shares, and current price
                        portfolio_tuples.append(
                            (entry["stock"].upper(), entry["shares"], current_price)
                        )
                    except Exception as e:
                        st.error(f"Error refetching price for {entry['stock']}: {e}")

            if portfolio_tuples:
                try:
                    # Recalculate portfolio risk with new time frame
                    portfolio_metrics = calculate_portfolio_risk(portfolio_tuples, period=new_time_frame)
                    st.session_state["portfolio_risk_results"] = portfolio_metrics
                except Exception as e:
                    st.session_state["portfolio_risk_results"] = {
                        "error": f"Error recalculating portfolio risk: {str(e)}"
                    }
        
        # 2. Cryptocurrency Statistics Update
        try:
            # Assuming you have a function to fetch crypto stats with a period parameter
            time_frame_mapping = {
                "6mo": 182,   # Approximation for 6 months
                "1y": 365,    # 1 year
                "5y": 1825    # 5 years
            }
            time_frame_mapped = time_frame_mapping[new_time_frame]
            
            # Update crypto stats in session state if needed
            # This is a placeholder - adjust based on your actual implementation
            crypto_stats = get_crypto_stats(st.session_state.get("selected_crypto", "BTC"), period=time_frame_mapped)
            st.session_state["crypto_stats"] = crypto_stats
        except Exception as e:
            st.error(f"Error updating crypto statistics: {e}")
        
        # 3. Volatility Fetcher Update
        try:
            # If you have a current ticker in session state or from a previous fetch
            current_ticker = st.session_state.get("current_volatility_ticker", "AAPL")
            volatility = fetch_volatility(current_ticker, period=new_time_frame)
            st.session_state["current_volatility"] = volatility
        except Exception as e:
            st.error(f"Error updating volatility: {e}")
    
    # Call the update function
    update_time_dependent_sections(time_frame)


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
        volatility = fetch_volatility(ticker_input, period=time_frame)
        volatility_display.markdown(f"**Volatility for {ticker_input.upper()}:** {volatility:.4f}")
    except Exception as e:
        volatility_display.markdown(f"Error fetching volatility: {str(e)}")

# Divider line
st.markdown("---")

# Title for the cryptocurrency section
st.header("Cryptocurrency Statistics")

# Create a dropdown to search/select a cryptocurrency
crypto_symbols = ['BTC', 'ETH', 'XRP', 'LTC', 'DOGE', 'ADA', 'SOL']
selected_crypto_symbol = st.selectbox("Select a Cryptocurrency", options=crypto_symbols, help="Select a cryptocurrency to get detailed information")

# Map time_frame to its equivalent value in days
time_frame_mapping = {
    "6mo": 182,  # Approximation for 6 months
    "1y": 365,   # 1 year
    "5y": 1825   # 5 years
}
time_frame_mapped = time_frame_mapping[time_frame]  # Convert time_frame to days

# Only update the placeholder with cryptocurrency details when a crypto is selected
if selected_crypto_symbol:
    stats = get_crypto_stats(selected_crypto_symbol, period = time_frame_mapped)

    if "error" in stats:
        st.error(stats["error"])
    else:
        # Display the current trading price and other details
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("Current Price (USD)", f"${stats['current_price']:,.2f}")
        with col2:
            st.metric("24h Return (%)", f"{stats['price_change_24h']:.2f}%")
        with col3:
            st.metric("Annual Return (%)", f"{stats['annual_return']:.2f}%")
        with col4: 
            st.metric("Annualized Volatility (%)", f"{stats['volatility']:.2f}%")
        

# Divider line
st.markdown("---")

# Sidebar Inputs for the Black-Scholes formula
st.sidebar.header("Input Parameters for Option Pricing")
S = st.sidebar.number_input("Current Stock Price (S)", min_value=0.0, step=1.0, value=100.0)
K = st.sidebar.number_input("Strike Price (K)", min_value=0.0, step=1.0, value=110.0)
T = st.sidebar.number_input("Time to Maturity (T) (in years)", min_value=0.01, step=0.01, value=1.0)
r = st.sidebar.number_input("Risk-Free Interest Rate (r) (as a decimal)", min_value=0.0, step=0.01, value=0.05)
sigma = st.sidebar.number_input("Volatility (σ) (as a decimal)", min_value=0.0, step=0.01, value=0.2)

st.header("Black-Scholes Calculation")

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

# Initialize session state for heatmap parameters and heatmaps
if "heatmap_params" not in st.session_state:
    st.session_state.heatmap_params = {
        "min_S": None,
        "max_S": None,
        "min_sigma": None,
        "max_sigma": None,
    }
    st.session_state.heatmaps = None  # Store generated heatmaps in session state

# Check for changes in the sidebar inputs
def has_heatmap_params_changed():
    return (
        st.session_state.heatmap_params["min_S"] != min_S
        or st.session_state.heatmap_params["max_S"] != max_S
        or st.session_state.heatmap_params["min_sigma"] != min_sigma
        or st.session_state.heatmap_params["max_sigma"] != max_sigma
    )

# Generate heatmaps if:
# - Parameters have changed, or
# - Heatmaps are not initialized (e.g., on the first page load)
if has_heatmap_params_changed() or st.session_state.heatmaps is None:
    # Generate heatmaps
    st.session_state.heatmaps = generate_heatmaps(S, K, T, r, min_S, max_S, min_sigma, max_sigma)
    
    # Update the session state with new parameters
    st.session_state.heatmap_params = {
        "min_S": min_S,
        "max_S": max_S,
        "min_sigma": min_sigma,
        "max_sigma": max_sigma,
    }

# Display the heatmaps from session state
if st.session_state.heatmaps:
    st.plotly_chart(st.session_state.heatmaps["call"], use_container_width=True)
    st.plotly_chart(st.session_state.heatmaps["put"], use_container_width=True)

# Calculate the risk of your overall portfolio and your expected rate of return
st.markdown("---")


# Portfolio Risk Calculator Section with Improved Session State Management
st.header("Portfolio Risk Calculator")

# Custom key for portfolio entries to avoid conflicts
PORTFOLIO_ENTRIES_KEY = "portfolio_risk_entries"
PORTFOLIO_RESULTS_KEY = "portfolio_risk_results"

# Initialize session state for portfolio entries if not already exists
if PORTFOLIO_ENTRIES_KEY not in st.session_state:
    st.session_state[PORTFOLIO_ENTRIES_KEY] = [{"stock": "", "shares": 0.0}]

# Initialize session state for storing portfolio results if not already exists
if PORTFOLIO_RESULTS_KEY not in st.session_state:
    st.session_state[PORTFOLIO_RESULTS_KEY] = None

# Function to add a new portfolio entry
def add_portfolio_entry():
    st.session_state[PORTFOLIO_ENTRIES_KEY].append({"stock": "", "shares": 0.0})

# Function to remove the last portfolio entry
def remove_portfolio_entry():
    if len(st.session_state[PORTFOLIO_ENTRIES_KEY]) > 1:
        st.session_state[PORTFOLIO_ENTRIES_KEY].pop()

# Function to calculate portfolio risk
def calculate_portfolio_risk_results():
    portfolio_tuples = []
    for entry in st.session_state[PORTFOLIO_ENTRIES_KEY]:
        if entry["stock"].strip() and entry["shares"] > 0:
            try:
                # Fetch current stock price
                stock = yf.Ticker(entry["stock"].upper())
                current_price = stock.history(period="1d")["Close"].iloc[-1]

                # Create tuple with stock ticker, shares, and current price
                portfolio_tuples.append(
                    (entry["stock"].upper(), entry["shares"], current_price)
                )
            except Exception as e:
                st.error(f"Error fetching price for {entry['stock']}: {e}")

    if portfolio_tuples:
        try:
            # Perform risk-return calculations using a helper module
            portfolio_metrics = calculate_portfolio_risk(portfolio_tuples, period=st.session_state["time_frame"])
            st.session_state[PORTFOLIO_RESULTS_KEY] = portfolio_metrics
        except Exception as e:
            st.session_state[PORTFOLIO_RESULTS_KEY] = {"error": f"Error calculating portfolio risk: {str(e)}"}
    else:
        st.session_state[PORTFOLIO_RESULTS_KEY] = {"warning": "Please enter at least one stock with a valid number of shares."}

# Portfolio Entry Input Layout
st.write("Enter your stock portfolio:")

# Create a container for portfolio entries to isolate updates
portfolio_container = st.container()

with portfolio_container:
    for i, entry in enumerate(st.session_state[PORTFOLIO_ENTRIES_KEY]):
        col1, col2, col3 = st.columns([3, 2, 1])

        with col1:
            # Stock ticker input with suggestions
            entry["stock"] = st.text_input(
                f"Stock Ticker {i + 1}",
                value=entry["stock"],
                key=f"stock_input_portfolio_{i}",
                placeholder="Enter stock ticker (e.g., AAPL)",
            )

        with col2:
            # Number of shares input - modified to allow decimal values
            entry["shares"] = st.number_input(
                f"Number of Shares {i + 1}",
                min_value=0.0,
                value=float(entry.get("shares", 0.0)),
                step=0.1,
                key=f"shares_input_portfolio_{i}",
                format="%.3f",
            )

        # Remove button for all entries except the first
        if i > 0:
            with col3:
                st.write("")  # Align with input
                st.button("➖", key=f"remove_portfolio_{i}", on_click=remove_portfolio_entry)

# Row of buttons for adding entries and calculating
col1, col2, col3 = st.columns(3)

with col1:
    st.button("Add Stock +", on_click=add_portfolio_entry, key="add_portfolio_stock")

with col2:
    calculate_portfolio = st.button("Calculate Portfolio Risk", key="calculate_portfolio_risk")

# Perform calculations when the button is pressed
if calculate_portfolio:
    calculate_portfolio_risk_results()

# Placeholder for portfolio risk results
portfolio_results = st.empty()

# Display stored portfolio results from session state
if st.session_state[PORTFOLIO_RESULTS_KEY]:
    if "error" in st.session_state[PORTFOLIO_RESULTS_KEY]:
        portfolio_results.error(st.session_state[PORTFOLIO_RESULTS_KEY]["error"])
    elif "warning" in st.session_state[PORTFOLIO_RESULTS_KEY]:
        portfolio_results.warning(st.session_state[PORTFOLIO_RESULTS_KEY]["warning"])
    else:
        portfolio_results.markdown("### Portfolio Analysis Results")

        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric(
                "Total Portfolio Value",
                f"${st.session_state[PORTFOLIO_RESULTS_KEY]['total_portfolio_value']:,.2f}",
                help="The total dollar value of your portfolio based on the current market prices of all included stocks.",
            )

        with col2:
            st.metric(
                "Expected Annual Return",
                f"{st.session_state[PORTFOLIO_RESULTS_KEY]['portfolio_expected_return']:.2f}%",
                help="The estimated percentage return your portfolio is expected to achieve annually.",
            )

        with col3:
            st.metric(
                "Portfolio Volatility",
                f"{st.session_state[PORTFOLIO_RESULTS_KEY]['portfolio_volatility']:.2f}%",
                help="A measure of the portfolio's risk. Higher values indicate more risk.",
            )

        with col4:
            st.metric(
                "Sharpe Ratio",
                f"{st.session_state[PORTFOLIO_RESULTS_KEY]['sharpe_ratio']:.2f}",
                help="A risk-adjusted measure of return.",
            )

        st.subheader("Individual Stock Details")

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
                for ticker, details in st.session_state[PORTFOLIO_RESULTS_KEY][
                    "stock_details"
                ].items()
            },
            orient="index",
        )

        # Display the DataFrame in Streamlit
        st.dataframe(stock_details_df.style.format({
            'Weight (%)': '{:.2f}',
            'Annual Return (%)': '{:.2f}',
            'Annual Volatility (%)': '{:.2f}',
            'Current Price': '${:.2f}',
            'Total Value': '${:,.2f}'
        }))


# Add LinkedIn profile link
st.markdown("---")
st.write("Made by [Thriambak Giriprakash MBA, SWE](https://www.linkedin.com/in/thriambakg/)")
