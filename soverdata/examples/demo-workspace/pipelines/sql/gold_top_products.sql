-- Gold layer: top revenue products for reporting.
-- Source: silver.sales_summary (created by transform_silver_sales)
-- target: gold.top_products

SELECT
    category,
    ROUND(SUM(total_revenue), 2)  AS total_revenue,
    SUM(orders)                   AS total_orders,
    ROUND(AVG(avg_order_value),2) AS avg_order_value
FROM silver__sales_summary
GROUP BY category
ORDER BY total_revenue DESC;
