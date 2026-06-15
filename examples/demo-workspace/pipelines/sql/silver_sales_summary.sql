-- target: silver.sales_summary
-- Join bronze tables and summarize checkout sales per customer
SELECT 
    c.id AS customer_id,
    c.name AS customer_name,
    c.country AS country,
    SUM(o.amount) AS total_spent,
    COUNT(o.id) AS order_count,
    ROUND(SUM(o.amount) / COUNT(o.id), 2) AS average_order_value
FROM bronze.customers c
JOIN bronze.orders o ON c.id = o.customer_id
GROUP BY c.id, c.name, c.country
ORDER BY total_spent DESC;
