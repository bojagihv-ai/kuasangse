const FACTORY_CAFE24_AUTO_DB_FIELD_IDS = [
  'product_name',
  'cafe24_product_no',
  'product_code',
  'option_count',
  'option_name',
  'option_values',
  'size',
  'sale_price',
  'consumer_price',
  'purchase_price',
  'stock',
  'weight',
  'material',
  'manufacturer',
  'supplier',
  'brand',
  'origin',
  'display_status',
  'selling_status',
  'search_keywords',
  'product_name_en',
  'admin_product_name',
  'supplier_product_name',
  'model_name',
  'product_status',
];

const CAFE24_FORM_SELECTS = {
  display: [
    { value: 'T', label: '진열함' },
    { value: 'F', label: '진열안함' },
  ],
  selling: [
    { value: 'T', label: '판매함' },
    { value: 'F', label: '판매안함' },
  ],
  productCondition: [
    { value: 'N', label: '신상품' },
    { value: 'U', label: '중고상품' },
    { value: 'R', label: '반품상품' },
  ],
  taxCalculation: [
    { value: 'M', label: '자동계산' },
    { value: 'A', label: '자동계산' },
    { value: 'C', label: '수동계산' },
  ],
  taxType: [
    { value: 'A', label: '과세' },
    { value: 'B', label: '면세' },
    { value: 'C', label: '영세' },
  ],
  productFlag: [
    { value: 'T', label: '사용함' },
    { value: 'F', label: '사용안함' },
  ],
  soldOut: [
    { value: 'F', label: '품절 아님' },
    { value: 'T', label: '품절 처리' },
  ],
  useInventory: [
    { value: 'T', label: '재고관리 사용' },
    { value: 'F', label: '재고관리 안 함' },
  ],
  importantInventory: [
    { value: 'A', label: '일반재고' },
    { value: 'B', label: '중요재고' },
  ],
  inventoryControlType: [
    { value: 'A', label: '주문 기준 차감' },
    { value: 'B', label: '결제 기준 차감' },
  ],
  hasOption: [
    { value: 'T', label: '옵션 사용' },
    { value: 'F', label: '옵션 사용 안 함' },
  ],
  optionType: [
    { value: 'C', label: '조합형 옵션' },
    { value: 'T', label: '조합형 옵션' },
    { value: 'E', label: '상품연동형 옵션' },
    { value: 'F', label: '독립선택형 옵션' },
  ],
  optionListType: [
    { value: 'C', label: '일체선택형' },
    { value: 'S', label: '분리선택형' },
  ],
  selectOneByOption: [
    { value: 'F', label: '옵션별 1개 선택 아님' },
    { value: 'T', label: '옵션별 1개 선택' },
  ],
  setProductType: [
    { value: 'F', label: '세트상품 아님' },
    { value: 'T', label: '세트상품' },
    { value: 'C', label: '일반 구성상품' },
  ],
  exposureLimitType: [
    { value: 'A', label: '모든 회원 노출' },
    { value: 'M', label: '회원등급별 노출' },
    { value: 'G', label: '특정 회원그룹 노출' },
  ],
  buyLimitType: [
    { value: 'O', label: '회원/비회원 모두' },
    { value: 'M', label: '회원만 구매' },
    { value: 'D', label: '특정 회원등급' },
  ],
  buyLimitByProduct: [
    { value: 'F', label: '기본설정 사용' },
    { value: 'T', label: '개별설정 사용' },
  ],
  purchaseRestriction: [
    { value: 'F', label: '제한없음' },
    { value: 'T', label: '제한함' },
  ],
  singlePurchase: [
    { value: 'F', label: '다른 상품과 함께 구매 가능' },
    { value: 'T', label: '단독구매 전용' },
  ],
  buyUnitType: [
    { value: 'O', label: '품목 기준' },
    { value: 'P', label: '상품 기준' },
  ],
  orderQuantityLimitType: [
    { value: 'O', label: '품목 기준' },
    { value: 'P', label: '상품 기준' },
  ],
  pointsByProduct: [
    { value: 'F', label: '기본설정 사용' },
    { value: 'T', label: '개별설정 사용' },
  ],
  pointsSettingByPayment: [
    { value: 'F', label: '결제수단별 적립 미사용' },
    { value: 'T', label: '결제수단별 적립 사용' },
    { value: 'B', label: '기본설정 사용' },
    { value: 'C', label: '개별설정 사용' },
  ],
  adultCertification: [
    { value: 'F', label: '사용안함' },
    { value: 'T', label: '사용함' },
  ],
  shippingFeeType: [
    { value: 'T', label: '무료' },
    { value: 'R', label: '고정배송비' },
    { value: 'M', label: '조건부 무료' },
    { value: 'D', label: '차등 배송비' },
    { value: 'C', label: '기본 배송비 설정' },
  ],
  shippingFeeByProduct: [
    { value: 'F', label: '기본 배송비 사용' },
    { value: 'T', label: '상품별 배송비 사용' },
  ],
  shippingScope: [
    { value: 'A', label: '국내배송' },
    { value: 'B', label: '해외배송' },
    { value: 'C', label: '국내/해외배송' },
  ],
  shippingCalculation: [
    { value: 'M', label: '묶음배송' },
    { value: 'A', label: '개별배송' },
  ],
  prepaidShippingFee: [
    { value: 'P', label: '선결제' },
    { value: 'C', label: '착불' },
    { value: 'B', label: '선결제/착불' },
  ],
  productShippingType: [
    { value: 'D', label: '기본 배송설정 사용' },
    { value: 'C', label: '상품별 배송설정' },
  ],
  shippingInfoByProduct: [
    { value: 'F', label: '기본 배송안내 사용' },
    { value: 'T', label: '상품별 배송안내 사용' },
  ],
  naverpayType: [
    { value: 'C', label: '사용함' },
    { value: 'N', label: '사용안함' },
  ],
  kakaopayType: [
    { value: 'C', label: '사용함' },
    { value: 'N', label: '사용안함' },
  ],
  originCountry: [
    { value: 'KR', label: '대한민국' },
    { value: 'CN', label: '중국' },
    { value: 'JP', label: '일본' },
    { value: 'US', label: '미국' },
    { value: 'VN', label: '베트남' },
    { value: 'IN', label: '인도' },
    { value: 'ID', label: '인도네시아' },
    { value: 'TH', label: '태국' },
    { value: 'TW', label: '대만' },
    { value: 'PH', label: '필리핀' },
  ],
  originClassification: [
    { value: 'F', label: '국내' },
    { value: 'T', label: '해외' },
    { value: 'E', label: '기타' },
  ],
};

const FACTORY_CAFE24_FIELD_SECTIONS = [
  { title: '기본 정보', fields: [
    { id: 'product_name', label: '한국어 쇼핑몰 상품명', required: true, dbFieldId: 'product_name', apiField: 'product_name', aliases: ['product_name','mall_product_name','상품명','한국어쇼핑몰상품명'] },
    { id: 'product_name_en', label: '쇼피싱가포르(영어) / 영문 상품명', dbFieldId: 'product_name_en', apiField: 'eng_product_name', aliases: ['eng_product_name','product_name_en','english_product_name','영문상품명'] },
    { id: 'admin_product_name', label: '상품명(관리용)', dbFieldId: 'admin_product_name', apiField: 'internal_product_name', aliases: ['internal_product_name','admin_product_name','상품명관리용'] },
    { id: 'supplier_product_name', label: '공급사 상품명', dbFieldId: 'supplier_product_name', apiField: 'supply_product_name', aliases: ['supply_product_name','supplier_product_name','vendor_product_name','공급사상품명'] },
    { id: 'model_name', label: '모델명', dbFieldId: 'model_name', apiField: 'model_name', aliases: ['model_name','model','모델명'] },
    { id: 'product_no', label: '상품번호', dbFieldId: 'cafe24_product_no', readonly: true, aliases: ['product_no','상품번호'] },
    { id: 'product_code', label: '상품코드', required: true, dbFieldId: 'cafe24_product_code', readonly: true, aliases: ['product_code','product_no','상품코드'] },
    { id: 'custom_product_code', label: '자체 상품코드', dbFieldId: 'custom_product_code', apiField: 'custom_product_code', aliases: ['custom_product_code','self_product_code','자체상품코드'] },
    { id: 'product_status', label: '상품상태', dbFieldId: 'product_status', apiField: 'product_condition', selectOptions: CAFE24_FORM_SELECTS.productCondition, aliases: ['product_condition','product_status','condition','상품상태'] },
    { id: 'approve_status', label: '승인 상태', dbFieldId: 'approve_status', readonly: true, syncNote: 'Cafe24가 관리하는 승인 상태입니다. 상품 저장 payload에서는 제외합니다.', aliases: ['approve_status','승인상태'] },
    { id: 'project_no', label: '프로젝트 번호', dbFieldId: 'project_no', readonly: true, syncNote: 'Cafe24 내부 프로젝트 번호입니다. 상품 저장 payload에서는 제외합니다.', aliases: ['project_no','프로젝트번호'] },
    { id: 'summary_description', label: '상품 요약설명', dbFieldId: 'summary_description', apiField: 'summary_description', aliases: ['summary_description','product_summary','상품요약설명'] },
    { id: 'simple_description', label: '상품 간략설명', dbFieldId: 'simple_description', apiField: 'simple_description', aliases: ['simple_description','brief_description','short_description','상품간략설명'] },
    { id: 'additional_description', label: '상품 추가정보', dbFieldId: 'additional_description', apiField: 'additional_information', aliases: ['additional_information','additional_description','extra_description','상품추가정보','상품추가설명'] },
  ]},
  { title: '가격 / 판매', fields: [
    { id: 'sale_price', label: '판매가', required: true, dbFieldId: 'sale_price', apiField: 'price', aliases: ['price','sale_price','selling_price','판매가'] },
    { id: 'consumer_price', label: '소비자가', required: true, dbFieldId: 'consumer_price', apiField: 'retail_price', aliases: ['retail_price','consumer_price','market_price','list_price','소비자가'] },
    { id: 'purchase_price', label: '공급가 / 원가', dbFieldId: 'purchase_price', apiField: 'supply_price', aliases: ['supply_price','supplier_price','purchase_price','cost','공급가','원가'] },
    { id: 'additional_price', label: '추가금액', dbFieldId: 'additional_price', apiField: 'additional_price', aliases: ['additional_price','추가금액'] },
    { id: 'margin_rate', label: '마진율', dbFieldId: 'margin_rate', readonly: true, syncNote: '마진율은 Cafe24가 가격 기준으로 계산해 보여주는 값이라 저장 payload에서는 제외합니다.', aliases: ['margin_rate','마진율'] },
    { id: 'price_content', label: '판매가 대체문구', dbFieldId: 'price_content', apiField: 'price_content', aliases: ['price_content','price_text','판매가대체문구'] },
    { id: 'display_status', label: '진열상태', dbFieldId: 'display_status', apiField: 'display', selectOptions: CAFE24_FORM_SELECTS.display, aliases: ['display_status','display','진열상태'] },
    { id: 'selling_status', label: '판매상태', dbFieldId: 'selling_status', apiField: 'selling', selectOptions: CAFE24_FORM_SELECTS.selling, aliases: ['selling_status','selling','판매상태'] },
    { id: 'tax_calculation', label: '세금 자동계산', dbFieldId: 'tax_calculation', apiField: 'tax_calculation', selectOptions: CAFE24_FORM_SELECTS.taxCalculation, aliases: ['tax_calculation','세금자동계산'] },
    { id: 'tax_type', label: '과세 구분', dbFieldId: 'tax_type', apiField: 'tax_type', selectOptions: CAFE24_FORM_SELECTS.taxType, aliases: ['tax_type','taxation','과세구분'] },
    { id: 'product_tax_type_text', label: '상품 과세문구', dbFieldId: 'product_tax_type_text', readonly: true, syncNote: 'Cafe24 표시용 과세 문구입니다. 과세 구분/세율을 수정하면 Cafe24가 다시 계산합니다.', aliases: ['product_tax_type_text','상품과세문구'] },
    { id: 'tax_rate', label: '세율', dbFieldId: 'tax_rate', apiField: 'tax_rate', aliases: ['tax_rate','세율'] },
    { id: 'stock', label: '재고수량', dbFieldId: 'stock', readonly: true, syncNote: '재고는 품목/재고 전용 API에서 따로 동기화합니다.', aliases: ['stock','stock_quantity','inventory','quantity','재고'] },
  ]},
  { title: '옵션 / 품목', fields: [
    { id: 'has_option', label: '옵션 사용 여부', dbFieldId: 'has_option', apiField: 'has_option', selectOptions: CAFE24_FORM_SELECTS.hasOption, aliases: ['has_option','옵션사용여부'] },
    { id: 'option_type', label: '옵션 구성 방식', dbFieldId: 'option_type', apiField: 'option_type', selectOptions: CAFE24_FORM_SELECTS.optionType, aliases: ['option_type','옵션구성방식'] },
    { id: 'option_list_type', label: '옵션 표시 방식', dbFieldId: 'option_list_type', apiField: 'option_list_type', selectOptions: CAFE24_FORM_SELECTS.optionListType, aliases: ['option_list_type','옵션표시방식'] },
    { id: 'option_name', label: '옵션명', dbFieldId: 'option_name', readonly: true, syncNote: '옵션명/옵션값은 상품 기본 저장과 분리된 품목/옵션 API로 동기화합니다.', aliases: ['option_name','option_names','옵션명'] },
    { id: 'option_values', label: '옵션값 전체', required: true, dbFieldId: 'option_values', readonly: true, syncNote: '옵션값은 현재 확인용입니다. 옵션 API 연결 단계에서 일괄 동기화합니다.', aliases: ['option_values','option_value','options','variants','color_options','색상옵션'] },
    { id: 'option_count', label: '옵션수', required: true, dbFieldId: 'option_count', readonly: true, aliases: ['option_count','option_value_count','variant_count','color_count','옵션수'] },
    { id: 'select_one_by_option', label: '옵션별 1개 선택', dbFieldId: 'select_one_by_option', apiField: 'select_one_by_option', selectOptions: CAFE24_FORM_SELECTS.selectOneByOption, aliases: ['select_one_by_option','옵션별1개선택'] },
    { id: 'set_product_type', label: '세트상품 구분', dbFieldId: 'set_product_type', apiField: 'set_product_type', selectOptions: CAFE24_FORM_SELECTS.setProductType, aliases: ['set_product_type','세트상품구분'] },
    { id: 'variant_code', label: '품목/옵션 코드', readonly: true, aliases: ['variant_code','item_code','variant_no','품목코드'] },
  ]},
  { title: '구매 / 혜택', fields: [
    { id: 'purchase_limit', label: '구매제한', dbFieldId: 'purchase_limit', apiField: 'buy_limit_by_product', selectOptions: CAFE24_FORM_SELECTS.buyLimitByProduct, aliases: ['buy_limit_by_product','purchase_limit','purchase_restriction','구매제한'] },
    { id: 'buy_limit_type', label: '구매제한 대상', dbFieldId: 'buy_limit_type', apiField: 'buy_limit_type', selectOptions: CAFE24_FORM_SELECTS.buyLimitType, aliases: ['buy_limit_type','구매제한대상'] },
    { id: 'buy_group_list', label: '구매 가능 회원등급', dbFieldId: 'buy_group_list', apiField: 'buy_group_list', aliases: ['buy_group_list','구매가능회원등급'] },
    { id: 'buy_member_id_list', label: '구매 가능 회원ID', dbFieldId: 'buy_member_id_list', apiField: 'buy_member_id_list', aliases: ['buy_member_id_list','구매가능회원ID'] },
    { id: 'repurchase_restriction', label: '재구매 제한', dbFieldId: 'repurchase_restriction', apiField: 'repurchase_restriction', selectOptions: CAFE24_FORM_SELECTS.purchaseRestriction, aliases: ['repurchase_restriction','재구매제한'] },
    { id: 'single_purchase_restriction', label: '단독구매 제한', dbFieldId: 'single_purchase_restriction', apiField: 'single_purchase_restriction', selectOptions: CAFE24_FORM_SELECTS.purchaseRestriction, aliases: ['single_purchase_restriction','단독구매제한'] },
    { id: 'single_purchase', label: '단독구매 설정', dbFieldId: 'single_purchase', apiField: 'single_purchase', selectOptions: CAFE24_FORM_SELECTS.singlePurchase, aliases: ['single_purchase','individual_purchase','단독구매'] },
    { id: 'buy_unit_type', label: '구매 주문단위 기준', dbFieldId: 'buy_unit_type', apiField: 'buy_unit_type', selectOptions: CAFE24_FORM_SELECTS.buyUnitType, aliases: ['buy_unit_type','purchase_unit_type','구매주문단위기준'] },
    { id: 'buy_unit', label: '구매 주문단위', dbFieldId: 'buy_unit', apiField: 'buy_unit', aliases: ['buy_unit','purchase_unit','order_unit','구매주문단위'] },
    { id: 'order_quantity_limit_type', label: '주문수량 제한 기준', dbFieldId: 'order_quantity_limit_type', apiField: 'order_quantity_limit_type', selectOptions: CAFE24_FORM_SELECTS.orderQuantityLimitType, aliases: ['order_quantity_limit_type','주문수량제한기준'] },
    { id: 'min_order_quantity', label: '최소 주문수량', dbFieldId: 'min_order_quantity', apiField: 'minimum_quantity', aliases: ['minimum_quantity','min_order_quantity','minimum_quantity','min_quantity','최소주문수량'] },
    { id: 'max_order_quantity', label: '최대 주문수량', dbFieldId: 'max_order_quantity', apiField: 'maximum_quantity', aliases: ['maximum_quantity','max_order_quantity','maximum_quantity','max_quantity','최대주문수량'] },
    { id: 'points', label: '적립금 개별설정', dbFieldId: 'points', apiField: 'points_by_product', selectOptions: CAFE24_FORM_SELECTS.pointsByProduct, aliases: ['points_by_product','points','mileage','reward_points','적립금'] },
    { id: 'points_amount', label: '적립금 지급액/비율', dbFieldId: 'points_amount', apiField: 'points_amount', aliases: ['points_amount','적립금지급액','적립금비율'] },
    { id: 'points_setting_by_payment', label: '결제수단별 적립금', dbFieldId: 'points_setting_by_payment', apiField: 'points_setting_by_payment', selectOptions: CAFE24_FORM_SELECTS.pointsSettingByPayment, aliases: ['points_setting_by_payment','결제수단별적립금'] },
    { id: 'except_member_points', label: '회원 적립 제외', dbFieldId: 'except_member_points', apiField: 'except_member_points', selectOptions: CAFE24_FORM_SELECTS.productFlag, aliases: ['except_member_points','회원적립제외'] },
    { id: 'discount_benefits', label: '할인혜택', dbFieldId: 'discount_benefits', readonly: true, syncNote: '할인혜택은 혜택/프로모션 API 영역입니다.', aliases: ['discount_benefits','discounts','benefits','할인혜택'] },
  ]},
  { title: '분류 / 제조', fields: [
    { id: 'category', label: '카테고리', dbFieldId: 'category', referenceType: 'categories', syncNote: '카테고리는 상품 기본 저장과 분리해서 카테고리 상품 연결 API로 동기화합니다.', aliases: ['category','categories','category_name','카테고리'] },
    { id: 'classification_code', label: '자체분류', dbFieldId: 'classification_code', apiField: 'classification_code', referenceType: 'classifications', aliases: ['classification_code','자체분류'] },
    { id: 'manufacturer', label: '제조사', required: true, dbFieldId: 'manufacturer', apiField: 'manufacturer_code', referenceType: 'manufacturers', aliases: ['manufacturer_code','manufacturer','maker','제조사'] },
    { id: 'supplier', label: '공급사', dbFieldId: 'supplier', apiField: 'supplier_code', referenceType: 'suppliers', aliases: ['supplier_code','supplier','vendor','vendor_name','공급사'] },
    { id: 'brand', label: '브랜드', dbFieldId: 'brand', apiField: 'brand_code', referenceType: 'brands', aliases: ['brand_code','brand','brand_name','브랜드'] },
    { id: 'trend_code', label: '트렌드', dbFieldId: 'trend_code', apiField: 'trend_code', referenceType: 'trends', aliases: ['trend_code','트렌드코드','트렌드'] },
    { id: 'origin', label: '원산지 국가', dbFieldId: 'origin', apiField: 'made_in_code', selectOptions: CAFE24_FORM_SELECTS.originCountry, aliases: ['made_in_code','origin','made_in','country_of_origin','원산지'] },
    { id: 'origin_classification', label: '원산지 구분', dbFieldId: 'origin_classification', apiField: 'origin_classification', selectOptions: CAFE24_FORM_SELECTS.originClassification, aliases: ['origin_classification','원산지구분'] },
    { id: 'origin_place_value', label: '원산지 직접입력', dbFieldId: 'origin_place_value', apiField: 'origin_place_value', aliases: ['origin_place_value','원산지직접입력'] },
    { id: 'origin_place_code', label: '원산지 장소', dbFieldId: 'origin_place_code', apiField: 'origin_place_code', referenceType: 'originPlaces', aliases: ['origin_place_code','원산지장소코드','원산지장소'] },
    { id: 'origin_place_no', label: '원산지 장소번호', dbFieldId: 'origin_place_no', apiField: 'origin_place_no', referenceType: 'originPlaces', aliases: ['origin_place_no','원산지장소번호'] },
    { id: 'material', label: '상품 소재', dbFieldId: 'material', apiField: 'product_material', aliases: ['product_material','material','fabric','소재'] },
    { id: 'english_product_material', label: '영문 상품 소재', dbFieldId: 'english_product_material', apiField: 'english_product_material', aliases: ['english_product_material','영문상품소재'] },
    { id: 'cloth_fabric', label: '섬유/원단', dbFieldId: 'cloth_fabric', apiField: 'cloth_fabric', aliases: ['cloth_fabric','섬유','원단'] },
    { id: 'adult_certification', label: '성인 인증', dbFieldId: 'adult_certification', apiField: 'adult_certification', selectOptions: CAFE24_FORM_SELECTS.adultCertification, aliases: ['adult_certification','성인인증'] },
  ]},
  { title: '규격 / 통관 / 기간', fields: [
    { id: 'product_weight', label: '상품 무게', dbFieldId: 'product_weight', apiField: 'product_weight', aliases: ['product_weight','weight','상품무게','무게'] },
    { id: 'product_volume', label: '상품 부피', dbFieldId: 'product_volume', apiField: 'product_volume', aliases: ['product_volume','상품부피','부피'] },
    { id: 'product_used_month', label: '사용 개월', dbFieldId: 'product_used_month', apiField: 'product_used_month', aliases: ['product_used_month','사용개월'] },
    { id: 'made_date', label: '제조일자', dbFieldId: 'made_date', apiField: 'made_date', aliases: ['made_date','제조일자'] },
    { id: 'release_date', label: '출시일자', dbFieldId: 'release_date', apiField: 'release_date', aliases: ['release_date','출시일자'] },
    { id: 'expiration_date', label: '유효기간', dbFieldId: 'expiration_date', apiField: 'expiration_date', aliases: ['expiration_date','유효기간'] },
    { id: 'country_hscode', label: '국가별 HS 코드', dbFieldId: 'country_hscode', apiField: 'country_hscode', aliases: ['country_hscode','국가별HS코드'] },
    { id: 'clearance_category_code', label: '통관 분류 코드', dbFieldId: 'clearance_category_code', apiField: 'clearance_category_code', aliases: ['clearance_category_code','통관분류코드'] },
    { id: 'clearance_category_kor', label: '통관 분류명(한글)', dbFieldId: 'clearance_category_kor', apiField: 'clearance_category_kor', aliases: ['clearance_category_kor','통관분류명한글'] },
    { id: 'clearance_category_eng', label: '통관 분류명(영문)', dbFieldId: 'clearance_category_eng', apiField: 'clearance_category_eng', aliases: ['clearance_category_eng','통관분류명영문'] },
  ]},
  { title: '상세 / 이미지', fields: [
    { id: 'main_image', label: '상세 이미지', dbFieldId: 'main_image', apiField: 'detail_image', aliases: ['detail_image','main_image','대표이미지'] },
    { id: 'list_image', label: '목록 이미지', dbFieldId: 'list_image', apiField: 'list_image', aliases: ['list_image','목록이미지'] },
    { id: 'list_icon', label: '목록 아이콘', dbFieldId: 'list_icon', readonly: true, syncNote: '목록 아이콘은 Cafe24가 표시 상태를 계산하는 내부 구조값이라 현재 입력/저장 대상에서 제외합니다.', aliases: ['list_icon','목록아이콘'] },
    { id: 'small_image', label: '작은 이미지', dbFieldId: 'small_image', apiField: 'small_image', aliases: ['small_image','작은이미지'] },
    { id: 'tiny_image', label: '썸네일 이미지', dbFieldId: 'tiny_image', apiField: 'tiny_image', aliases: ['tiny_image','썸네일이미지'] },
    { id: 'image_upload_type', label: '이미지 등록 방식', dbFieldId: 'image_upload_type', apiField: 'image_upload_type', aliases: ['image_upload_type','이미지등록방식'] },
    { id: 'detail_html_pc', label: 'PC 상세설명 HTML', dbFieldId: 'detail_html_pc', apiField: 'description', aliases: ['description','detail_html_pc','pc_description','PC상세설명'] },
    { id: 'detail_html_mobile', label: '모바일 상세설명 HTML', dbFieldId: 'detail_html_mobile', apiField: 'mobile_description', aliases: ['mobile_description','detail_html_mobile','모바일상세설명'] },
    { id: 'translated_description', label: '번역 상세설명', dbFieldId: 'translated_description', apiField: 'translated_description', aliases: ['translated_description','번역상세설명'] },
    { id: 'translated_additional_description', label: '번역 추가설명', dbFieldId: 'translated_additional_description', apiField: 'translated_additional_description', aliases: ['translated_additional_description','번역추가설명'] },
    { id: 'separated_mobile_description', label: '모바일 별도등록', dbFieldId: 'separated_mobile_description', apiField: 'separated_mobile_description', selectOptions: CAFE24_FORM_SELECTS.productFlag, aliases: ['separated_mobile_description','모바일별도등록'] },
  ]},
  { title: '배송 / 반품', fields: [
    { id: 'payment_info', label: '결제 안내', dbFieldId: 'payment_info', apiField: 'payment_info', aliases: ['payment_info','결제안내'] },
    { id: 'payment_info_by_product', label: '결제 안내 개별설정', dbFieldId: 'payment_info_by_product', apiField: 'payment_info_by_product', selectOptions: CAFE24_FORM_SELECTS.productFlag, aliases: ['payment_info_by_product','결제안내개별설정'] },
    { id: 'shipping_info_by_product', label: '배송 안내 개별설정', dbFieldId: 'shipping_info_by_product', apiField: 'shipping_info_by_product', selectOptions: CAFE24_FORM_SELECTS.shippingInfoByProduct, aliases: ['shipping_info_by_product','배송안내개별설정'] },
    { id: 'shipping_info', label: '배송 안내', dbFieldId: 'shipping_info', apiField: 'shipping_info', aliases: ['shipping_info','배송안내'] },
    { id: 'product_shipping_type', label: '배송비 설정 방식', dbFieldId: 'product_shipping_type', apiField: 'product_shipping_type', selectOptions: CAFE24_FORM_SELECTS.productShippingType, aliases: ['product_shipping_type','배송비설정방식'] },
    { id: 'shipping_method', label: '배송방법', dbFieldId: 'shipping_method', apiField: 'shipping_method', referenceType: 'shippingMethods', aliases: ['shipping_method','배송방법'] },
    { id: 'shipping_scope', label: '배송가능 지역', dbFieldId: 'shipping_scope', apiField: 'shipping_scope', selectOptions: CAFE24_FORM_SELECTS.shippingScope, aliases: ['shipping_scope','배송가능지역'] },
    { id: 'shipping_calculation', label: '배송비 계산 기준', dbFieldId: 'shipping_calculation', apiField: 'shipping_calculation', selectOptions: CAFE24_FORM_SELECTS.shippingCalculation, aliases: ['shipping_calculation','배송비계산기준'] },
    { id: 'prepaid_shipping_fee', label: '배송비 결제 방식', dbFieldId: 'prepaid_shipping_fee', apiField: 'prepaid_shipping_fee', selectOptions: CAFE24_FORM_SELECTS.prepaidShippingFee, aliases: ['prepaid_shipping_fee','배송비결제방식'] },
    { id: 'shipping_place_code', label: '출고지', dbFieldId: 'shipping_place_code', apiField: 'shipping_place_code', referenceType: 'shippingOrigins', aliases: ['shipping_place_code','출고지'] },
    { id: 'shipping_area', label: '배송지역', dbFieldId: 'shipping_area', apiField: 'shipping_area', aliases: ['shipping_area','배송지역'] },
    { id: 'shipping_area_name', label: '배송지역명', dbFieldId: 'shipping_area_name', apiField: 'shipping_area_name', aliases: ['shipping_area_name','배송지역명','배송지역 이름'] },
    { id: 'shipping_period', label: '배송기간', dbFieldId: 'shipping_period', apiField: 'shipping_period', aliases: ['shipping_period','배송기간'] },
    { id: 'shipping_fee_type', label: '배송비 타입', dbFieldId: 'shipping_fee_type', apiField: 'shipping_fee_type', selectOptions: CAFE24_FORM_SELECTS.shippingFeeType, aliases: ['shipping_fee_type','shipping_type','배송비'] },
    { id: 'shipping_fee', label: '배송비', dbFieldId: 'shipping_fee', apiField: 'shipping_fee', aliases: ['shipping_fee','배송비'] },
    { id: 'shipping_fee_by_product', label: '상품별 배송비', dbFieldId: 'shipping_fee_by_product', apiField: 'shipping_fee_by_product', selectOptions: CAFE24_FORM_SELECTS.shippingFeeByProduct, aliases: ['shipping_fee_by_product','상품별배송비'] },
    { id: 'shipping_rates', label: '배송비 구간', dbFieldId: 'shipping_rates', apiField: 'shipping_rates', aliases: ['shipping_rates','배송비구간'] },
    { id: 'return_exchange_info', label: '교환/반품 안내', dbFieldId: 'return_exchange_info', apiField: 'exchange_info', aliases: ['exchange_info','return_exchange_info','교환반품안내'] },
    { id: 'exchange_info_by_product', label: '교환/반품 개별설정', dbFieldId: 'exchange_info_by_product', apiField: 'exchange_info_by_product', selectOptions: CAFE24_FORM_SELECTS.productFlag, aliases: ['exchange_info_by_product','교환반품개별설정'] },
    { id: 'service_info', label: '서비스 문의 안내', dbFieldId: 'service_info', apiField: 'service_info', aliases: ['service_info','서비스문의'] },
    { id: 'service_info_by_product', label: '서비스 안내 개별설정', dbFieldId: 'service_info_by_product', apiField: 'service_info_by_product', selectOptions: CAFE24_FORM_SELECTS.productFlag, aliases: ['service_info_by_product','서비스안내개별설정'] },
  ]},
  { title: '검색 / 운영 / 부가', fields: [
    { id: 'search_keywords', label: '검색/노출 키워드', dbFieldId: 'search_keywords', apiField: 'product_tag', aliases: ['product_tag','search_keywords','keywords','tags','검색키워드'] },
    { id: 'sold_out', label: '품절 상태', dbFieldId: 'sold_out', apiField: 'sold_out', selectOptions: CAFE24_FORM_SELECTS.soldOut, aliases: ['sold_out','품절상태'] },
    { id: 'soldout_message', label: '품절 안내 문구', dbFieldId: 'soldout_message', apiField: 'soldout_message', aliases: ['soldout_message','품절문구'] },
    { id: 'icon', label: '상품 아이콘', dbFieldId: 'icon', readonly: true, syncNote: '상품 아이콘은 아래 Cafe24 상품 아이콘 패널에서 아이콘 API로 동기화합니다.', aliases: ['icon','상품아이콘'] },
    { id: 'icon_show_period', label: '아이콘 표시기간', dbFieldId: 'icon_show_period', readonly: true, syncNote: '아이콘 표시기간은 아래 Cafe24 상품 아이콘 패널에서 아이콘 API로 동기화합니다.', aliases: ['icon_show_period','아이콘표시기간'] },
    { id: 'promotion_period', label: '프로모션 기간', dbFieldId: 'promotion_period', apiField: 'promotion_period', aliases: ['promotion_period','프로모션기간'] },
    { id: 'use_naverpay', label: '네이버페이 사용', dbFieldId: 'use_naverpay', apiField: 'use_naverpay', selectOptions: CAFE24_FORM_SELECTS.productFlag, aliases: ['use_naverpay','네이버페이사용'] },
    { id: 'naverpay_type', label: '네이버페이 타입', dbFieldId: 'naverpay_type', apiField: 'naverpay_type', selectOptions: CAFE24_FORM_SELECTS.naverpayType, aliases: ['naverpay_type','네이버페이타입'] },
    { id: 'use_kakaopay', label: '카카오페이 사용', dbFieldId: 'use_kakaopay', apiField: 'use_kakaopay', selectOptions: CAFE24_FORM_SELECTS.productFlag, aliases: ['use_kakaopay','카카오페이사용'] },
    { id: 'kakaopay_type', label: '카카오페이 타입', dbFieldId: 'kakaopay_type', apiField: 'kakaopay_type', selectOptions: CAFE24_FORM_SELECTS.kakaopayType, aliases: ['kakaopay_type','카카오페이타입'] },
    { id: 'market_sync', label: '마켓 연동', dbFieldId: 'market_sync', apiField: 'market_sync', selectOptions: CAFE24_FORM_SELECTS.productFlag, aliases: ['market_sync','마켓연동'] },
    { id: 'exposure_limit_type', label: '노출 제한', dbFieldId: 'exposure_limit_type', apiField: 'exposure_limit_type', selectOptions: CAFE24_FORM_SELECTS.exposureLimitType, aliases: ['exposure_limit_type','노출제한'] },
    { id: 'exposure_group_list', label: '노출 회원등급', dbFieldId: 'exposure_group_list', apiField: 'exposure_group_list', aliases: ['exposure_group_list','노출회원등급'] },
    { id: 'main_display', label: '메인 진열 정보', dbFieldId: 'main_display', readonly: true, syncNote: 'Cafe24 메인 진열 연결 정보입니다. 전용 진열 API가 확인되면 별도 동기화로 연결합니다.', aliases: ['main','main_display','메인진열'] },
    { id: 'relational_product', label: '관련상품', dbFieldId: 'relational_product', readonly: true, syncNote: '관련상품은 상품 기본 저장과 분리된 연결 정보라 현재는 읽기전용으로 표시합니다.', aliases: ['relational_product','관련상품'] },
    { id: 'size_guide', label: '사이즈 가이드', dbFieldId: 'size_guide', apiField: 'size_guide', aliases: ['size_guide','사이즈가이드'] },
    { id: 'hscode', label: 'HS 코드', dbFieldId: 'hscode', apiField: 'hscode', aliases: ['hscode','hs_code','HS코드'] },
    { id: 'memo', label: '관리 메모', dbFieldId: 'memo', readonly: true, syncNote: '관리 메모는 상품 기본 API가 아닌 운영 메모 영역입니다.', aliases: ['memo','admin_memo','관리메모'] },
  ]},
];

function factoryCafe24FormFieldsFlat() {
  return FACTORY_CAFE24_FIELD_SECTIONS.flatMap(section =>
    section.fields.map(field => ({ ...field, sectionTitle: section.title }))
  );
}

const FACTORY_CAFE24_INPUT_HIDDEN_IDS = new Set([
  'approve_status',
  'project_no',
  'margin_rate',
  'product_tax_type_text',
  'stock',
  'discount_benefits',
  'option_name',
  'option_values',
  'option_count',
  'variant_code',
  'main_image',
  'list_image',
  'list_icon',
  'small_image',
  'tiny_image',
  'image_upload_type',
  'icon',
  'icon_show_period',
  'main_display',
  'relational_product',
  'memo',
]);

function factoryCafe24FieldVisibleInInput(field = {}) {
  return !field.readonly && !field.hiddenInCafe24Input && !FACTORY_CAFE24_INPUT_HIDDEN_IDS.has(field.id);
}

function factoryCafe24FieldUiKey(field = {}) {
  return String(field.dbFieldId || field.id || field.apiField || '').trim();
}

function factoryNormalizeCafe24HiddenIds(value = []) {
  return Array.isArray(value)
    ? [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))]
    : [];
}

function factoryNormalizeCafe24FieldPreset(preset = {}, index = 0) {
  if (!preset || typeof preset !== 'object') return null;
  const savedAt = Number(preset.savedAt);
  return {
    id: String(preset.id || `preset_${index + 1}`).trim(),
    name: String(preset.name || `프리셋 ${index + 1}`).trim(),
    hiddenFieldIds: factoryNormalizeCafe24HiddenIds(preset.hiddenFieldIds),
    savedAt: Number.isFinite(savedAt) ? savedAt : null,
  };
}

function factoryMergeCafe24FieldPresets(primary = [], fallback = []) {
  const merged = new Map();
  const addPreset = (preset, index) => {
    const normalized = factoryNormalizeCafe24FieldPreset(preset, index);
    if (!normalized?.id || !normalized.name) return;
    const key = normalized.id || normalized.name;
    merged.set(key, {
      ...(merged.get(key) || {}),
      ...normalized,
      hiddenFieldIds: normalized.hiddenFieldIds,
    });
  };
  (Array.isArray(fallback) ? fallback : []).forEach(addPreset);
  (Array.isArray(primary) ? primary : []).forEach(addPreset);
  return [...merged.values()]
    .sort((a, b) => Number(a.savedAt || 0) - Number(b.savedAt || 0))
    .slice(-30);
}

function factoryNormalizeCafe24FieldView(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const backup = fallback && typeof fallback === 'object' ? fallback : {};
  const sourceHidden = factoryNormalizeCafe24HiddenIds(source.hiddenFieldIds);
  const backupHidden = factoryNormalizeCafe24HiddenIds(backup.hiddenFieldIds);
  const sourceDefaultSavedAt = Number.isFinite(Number(source.defaultSavedAt)) ? Number(source.defaultSavedAt) : null;
  const backupDefaultSavedAt = Number.isFinite(Number(backup.defaultSavedAt)) ? Number(backup.defaultSavedAt) : null;
  const shouldUseBackupDefault = !!backupDefaultSavedAt &&
    (!sourceDefaultSavedAt || backupDefaultSavedAt > sourceDefaultSavedAt) &&
    backupHidden.length > 0;
  const hiddenFieldIds = shouldUseBackupDefault
    ? backupHidden
    : (Array.isArray(source.hiddenFieldIds) ? sourceHidden : backupHidden);
  const presets = factoryMergeCafe24FieldPresets(source.presets, backup.presets);
  const sourceActivePresetId = typeof source.activePresetId === 'string' ? source.activePresetId : '';
  const backupActivePresetId = typeof backup.activePresetId === 'string' ? backup.activePresetId : '';
  const activePresetId = sourceActivePresetId || backupActivePresetId || '';
  const defaultSavedAt = Math.max(Number(sourceDefaultSavedAt || 0), Number(backupDefaultSavedAt || 0)) || null;
  return { hiddenFieldIds, presets, activePresetId, defaultSavedAt };
}

function factoryLoadCafe24FieldViewStorage() {
  return factoryNormalizeCafe24FieldView(loadJson(STORAGE_KEYS.cafe24FieldView, {}));
}

function factorySaveCafe24FieldViewStorage(view) {
  const normalized = factoryNormalizeCafe24FieldView(view);
  saveJson(STORAGE_KEYS.cafe24FieldView, normalized);
}

function factoryCafe24FieldViewState(factory = factoryRuntimeReadFactory()) {
  return factoryNormalizeCafe24FieldView(factory.cafe24FieldView, factoryLoadCafe24FieldViewStorage());
}

function factoryCafe24HiddenFieldSet(factory = factoryRuntimeReadFactory()) {
  return new Set(factoryCafe24FieldViewState(factory).hiddenFieldIds);
}

function factoryCafe24UserVisibleSections(sections = [], factory = factoryRuntimeReadFactory()) {
  const hidden = factoryCafe24HiddenFieldSet(factory);
  return sections
    .map(section => ({
      ...section,
      fields: section.fields.filter(field => !hidden.has(factoryCafe24FieldUiKey(field))),
    }))
    .filter(section => section.fields.length);
}

function factoryCafe24UserHiddenSections(sections = [], factory = factoryRuntimeReadFactory()) {
  const hidden = factoryCafe24HiddenFieldSet(factory);
  return sections
    .map(section => ({
      ...section,
      fields: section.fields.filter(field => hidden.has(factoryCafe24FieldUiKey(field))),
    }))
    .filter(section => section.fields.length);
}

function factoryCafe24EmptyVisibleFieldKeys(baseModel = null, factory = factoryRuntimeReadFactory()) {
  const sections = baseModel?.sections || [];
  return factoryCafe24UserVisibleSections(sections, factory)
    .flatMap(section => section.fields)
    .filter(field => factoryCafe24FieldUiKey(field) && !String(field.value || '').trim())
    .map(factoryCafe24FieldUiKey);
}

function factoryCafe24VisibleSections(sections = FACTORY_CAFE24_FIELD_SECTIONS) {
  return sections
    .map(section => ({
      ...section,
      fields: section.fields.filter(factoryCafe24FieldVisibleInInput),
    }))
    .filter(section => section.fields.length);
}

const FACTORY_CAFE24_DEDICATED_API_FIELDS = new Set([
  'category',
  'categories',
  'category_list',
  'product_category',
  'product_categories',
  'detail_image',
  'list_image',
  'small_image',
  'tiny_image',
  'additional_image',
  'additional_images',
  'image_upload_type',
  'icon',
  'icons',
  'product_icon',
  'product_icons',
  'icon_show_period',
  'list_icon',
  'has_option',
  'option',
  'options',
  'product_options',
  'option_name',
  'option_names',
  'option_value',
  'option_values',
  'option_count',
  'option_type',
  'option_list_type',
  'select_one_by_option',
  'variants',
  'variant',
  'variant_code',
  'variants_count',
  'inventory',
  'inventories',
  'stock',
  'stock_quantity',
  'quantity',
  'main',
  'main_display',
  'relational_product',
  'relational_products',
  'memo',
  'memos',
  'admin_memo',
  'product_memo',
  'product_memos',
  'seo',
  'product_seo',
  'meta_title',
  'meta_author',
  'meta_description',
  'meta_keywords',
  'meta_alt',
  'search_engine_exposure',
  'tags',
  'product_tag',
  'product_tags',
]);

const FACTORY_CAFE24_READONLY_API_FIELDS = new Set([
  'product_no',
  'product_code',
  'shop_no',
  'mall_id',
  'approve_status',
  'project_no',
  'created_date',
  'updated_date',
  'modified_date',
  'deleted',
  'hits',
  'like_count',
  'reviews_count',
  'margin_rate',
  'product_tax_type_text',
  'source',
  'connector_id',
  'matched_at',
  'match_query',
  'match_score',
  'local_match_score',
  'gpt_similarity_score',
  'gpt_decision',
  'gpt_reason',
  'gpt_rank',
  'index',
  'raw',
  'raw_product',
  'rawproduct',
  'rawProduct',
]);

const FACTORY_CAFE24_COVERAGE_IGNORED_FIELDS = new Set([
  'source',
  'connector_id',
  'matched_at',
  'match_query',
  'match_score',
  'local_match_score',
  'gpt_similarity_score',
  'gpt_decision',
  'gpt_reason',
  'gpt_rank',
  'index',
  'raw',
  'raw_product',
  'rawproduct',
  'rawProduct',
  'raw_json',
  'rawjson',
  'rawJson',
  'raw_data',
  'rawdata',
  'rawData',
  'rawProductJson',
]);

function factoryCafe24ShouldIgnoreCoverageKey(key = '') {
  const raw = String(key || '').trim();
  if (!raw) return true;
  const normalized = factoryDbNormalizeKey(raw);
  return FACTORY_CAFE24_COVERAGE_IGNORED_FIELDS.has(raw) ||
    FACTORY_CAFE24_COVERAGE_IGNORED_FIELDS.has(raw.toLowerCase()) ||
    FACTORY_CAFE24_COVERAGE_IGNORED_FIELDS.has(normalized) ||
    /^gpt_/i.test(raw) ||
    /^raw/i.test(raw) ||
    /^(match|matched|local_match)/i.test(raw) ||
    /connector/i.test(raw);
}

function factoryCafe24CoverageAliasSet(fields = []) {
  const set = new Set();
  fields.forEach(field => {
    [
      field.id,
      field.dbFieldId,
      field.apiField,
      ...(field.aliases || []),
    ].filter(Boolean).forEach(value => {
      const raw = String(value || '').trim();
      if (!raw) return;
      set.add(raw);
      set.add(raw.toLowerCase());
      set.add(factoryDbNormalizeKey(raw));
    });
  });
  return set;
}

function factoryCafe24CoverageHas(set, value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  return set.has(raw) || set.has(raw.toLowerCase()) || set.has(factoryDbNormalizeKey(raw));
}

function factoryCafe24CoverageLabel(key) {
  const raw = String(key || '').trim();
  if (!raw) return '빈 필드';
  const label = factoryCafe24FieldLabelByApiField(raw) || factoryDisplayFieldLabel(raw);
  return label || raw;
}

function factoryCafe24ProductFieldCoverage(factory = factoryRuntimeReadFactory()) {
  const raw = factoryCafe24RawForForm(factory);
  const sourceKeys = raw && typeof raw === 'object'
    ? Object.keys(raw).filter(key => raw[key] !== undefined && typeof raw[key] !== 'function' && !factoryCafe24ShouldIgnoreCoverageKey(key))
    : [];
  const visibleFields = factoryCafe24VisibleSections(FACTORY_CAFE24_FIELD_SECTIONS).flatMap(section => section.fields);
  const hiddenFields = factoryCafe24FormFieldsFlat().filter(field => !factoryCafe24FieldVisibleInInput(field));
  const visibleSet = factoryCafe24CoverageAliasSet(visibleFields);
  const hiddenSet = factoryCafe24CoverageAliasSet(hiddenFields);
  const dedicatedSet = factoryCafe24CoverageAliasSet([
    ...FACTORY_CAFE24_FIELD_SECTIONS.flatMap(section => section.fields).filter(field => FACTORY_CAFE24_DEDICATED_API_FIELDS.has(field.id) || FACTORY_CAFE24_DEDICATED_API_FIELDS.has(field.apiField)),
  ]);
  const dedicatedRawSet = new Set([...FACTORY_CAFE24_DEDICATED_API_FIELDS].flatMap(key => [key, key.toLowerCase(), factoryDbNormalizeKey(key)]));
  const readonlyRawSet = new Set([...FACTORY_CAFE24_READONLY_API_FIELDS].flatMap(key => [key, key.toLowerCase(), factoryDbNormalizeKey(key)]));
  const buckets = {
    form: [],
    dedicated: [],
    readonly: [],
    unknown: [],
  };
  sourceKeys.forEach(key => {
    const normalized = factoryDbNormalizeKey(key);
    if (factoryCafe24CoverageHas(dedicatedSet, key) || dedicatedRawSet.has(key) || dedicatedRawSet.has(String(key).toLowerCase()) || dedicatedRawSet.has(normalized)) buckets.dedicated.push(key);
    else if (factoryCafe24CoverageHas(visibleSet, key)) buckets.form.push(key);
    else if (factoryCafe24CoverageHas(hiddenSet, key) || readonlyRawSet.has(key) || readonlyRawSet.has(String(key).toLowerCase()) || readonlyRawSet.has(normalized)) buckets.readonly.push(key);
    else buckets.unknown.push(key);
  });
  Object.keys(buckets).forEach(name => {
    buckets[name] = [...new Set(buckets[name])].sort((a, b) => factoryCafe24CoverageLabel(a).localeCompare(factoryCafe24CoverageLabel(b), 'ko'));
  });
  return {
    total: sourceKeys.length,
    visibleFieldCount: visibleFields.length,
    buckets,
    covered: buckets.form.length + buckets.dedicated.length + buckets.readonly.length,
  };
}
