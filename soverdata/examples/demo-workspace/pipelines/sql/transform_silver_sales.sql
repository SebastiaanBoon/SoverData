-- Silver transform: clean and enrich the Bronze sales table.
-- Creates a monthly summary by product category.
--
-- Bronze table is registered as: bronze__sales
-- target: silver.sales_summary

SELECT
    strftime(order_date, '%Y-%m') AS month,
    category,
    COUNT(*)                      AS orders,
    SUM(quantity)                 AS total_units,
    ROUND(SUM(revenue), 2)        AS total_revenue,
    ROUND(AVG(revenue), 2)        AS avg_order_value
FROM bronze__sales
GROUP BY 1, 2
ORDER BY 1 DESC, 6 DESC;
