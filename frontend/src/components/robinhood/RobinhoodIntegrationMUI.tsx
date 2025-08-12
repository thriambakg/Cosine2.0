[Previous content...]

              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="Volatility (Risk)"
                  value={`${portfolioAnalysis.portfolio_volatility.toFixed(2)}%`}
                  icon={AssessmentIcon}
                  color="warning"
                />
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <MetricCard
                  title="Sharpe Ratio"
                  value={portfolioAnalysis.sharpe_ratio.toFixed(2)}
                  icon={AnalyticsIcon}
                  color="secondary"
                />
              </Grid>
            </Grid>

            {/* Individual Stock Details */}
            <Box>
              <Typography variant="h6" fontWeight={600} color="text.primary" mb={3}>
                Individual Holdings
              </Typography>

              <TableContainer
                component={Paper}
                sx={{
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: 2,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>Stock</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>Shares</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>Price</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>Value</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>Weight</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>Return</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>Volatility</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(portfolioAnalysis.stock_details).map(([ticker, details]) => (
                      <TableRow
                        key={ticker}
                        sx={{
                          '&:hover': {
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          },
                        }}
                      >
                        <TableCell sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {ticker}
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'text.primary' }}>
                          {details.shares}
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'text.primary' }}>
                          ${details.current_price.toFixed(2)}
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'text.primary' }}>
                          ${details.total_value.toFixed(2)}
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'text.primary' }}>
                          {details.weight.toFixed(1)}%
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            color: details.annual_return >= 0 ? 'success.main' : 'error.main',
                            fontWeight: 500,
                          }}
                        >
                          {details.annual_return.toFixed(2)}%
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'text.primary' }}>
                          {details.annual_volatility.toFixed(2)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Box>
        </GlassCard>
      )}
    </Box>
  );
}